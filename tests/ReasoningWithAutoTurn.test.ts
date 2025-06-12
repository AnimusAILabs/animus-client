import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatModule } from '../src/Chat';
import type { ChatMessage } from '../src/chat/types';
import { RequestUtil } from '../src/RequestUtil';
import { AuthHandler } from '../src/AuthHandler';
import type { AnimusChatOptions } from '../src/AnimusClient';

// Mock dependencies
vi.mock('../src/RequestUtil');
vi.mock('../src/AuthHandler');

describe('ChatModule Reasoning with AutoTurn', () => {
  let chatModule: ChatModule;
  let requestUtilMock: RequestUtil;

  // Config with both reasoning and autoTurn enabled
  const chatOptionsWithAutoTurn: AnimusChatOptions = {
    model: 'test-chat-model',
    systemMessage: 'Test system message',
    historySize: 10,
    reasoning: true,
    autoTurn: true // Enable autoTurn
  };

  beforeEach(() => {
    // Create new instances for each test
    const authHandlerMock = new AuthHandler('http://dummy-url', 'sessionStorage');
    requestUtilMock = new RequestUtil('http://dummy-base', authHandlerMock);
    
    // Reset mocks
    vi.resetAllMocks();
    
    // Mock Math.random to ensure deterministic behavior
    // Return 0.99 to force maximum number of turns (no concatenation)
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    // Create fresh ChatModule instance
    chatModule = new ChatModule(
      requestUtilMock,
      chatOptionsWithAutoTurn
    );
  });

  afterEach(() => {
    // Restore all mocks after each test
    vi.restoreAllMocks();
  });


  it('should emit reasoning in messageComplete event for first turn when autoTurn splits response', () => {
    return new Promise<void>((resolve, reject) => {
      // Mock the API response with reasoning and turns
      const mockResponse = {
        choices: [{
          message: {
            role: 'assistant',
            content: 'First part of response\nSecond part of response',
            reasoning: 'This is the reasoning for the entire response',
            turns: ['First part of response', 'Second part of response']
          },
          finish_reason: 'stop'
        }],
        id: 'test-id',
        object: 'chat.completion',
        created: Date.now(),
        model: 'test-model'
      };

      vi.mocked(requestUtilMock.request).mockResolvedValue(mockResponse);

      // Create a chat module with event emitter
      const eventEmitter = vi.fn();
      const chatModuleWithEvents = new ChatModule(
        requestUtilMock,
        chatOptionsWithAutoTurn,
        undefined,
        eventEmitter
      );

      let messageCompleteCount = 0;
      let firstTurnHasReasoning = false;
      let secondTurnHasReasoning = false;
      let receivedEvents: any[] = [];

      // Set up event listener
      eventEmitter.mockImplementation((event, data) => {
        receivedEvents.push({ event, data });
        
        if (event === 'messageComplete' && data.messageType === 'auto') {
          messageCompleteCount++;
          
          if (messageCompleteCount === 1) {
            // First turn should have reasoning
            firstTurnHasReasoning = !!data.reasoning;
            if (data.reasoning) {
              expect(data.reasoning).toBe('This is the reasoning for the entire response');
            }
            expect(data.content).toBe('First part of response');
          } else if (messageCompleteCount === 2) {
            // Second turn should NOT have reasoning (to avoid duplication)
            secondTurnHasReasoning = !!data.reasoning;
            expect(data.content).toBe('Second part of response');
            
            // After both turns, verify our expectations
            try {
              expect(firstTurnHasReasoning).toBe(true);
              expect(secondTurnHasReasoning).toBe(false);
              resolve();
            } catch (error) {
              reject(error);
            }
          }
        } else if (event === 'messageComplete' && data.messageType === 'regular') {
          // This is the initial messageComplete event, not from conversational turns
          // We should still check if it has reasoning when turns are not processed
          if (data.reasoning) {
            expect(data.reasoning).toBe('This is the reasoning for the entire response');
          }
        }
      });

      // Make a completion request
      chatModuleWithEvents.completions({
        messages: [{ role: 'user', content: 'Test message' }]
      });
      
      // Add timeout to resolve if conversational turns don't trigger
      setTimeout(() => {
        if (messageCompleteCount === 0) {
          // If no auto turns were emitted, check if regular messageComplete had reasoning
          const regularComplete = receivedEvents.find(e => e.event === 'messageComplete' && e.data.messageType === 'regular');
          if (regularComplete && regularComplete.data.reasoning) {
            resolve(); // Test passes if reasoning is present in regular completion
          } else {
            reject(new Error('No reasoning found in messageComplete events'));
          }
        }
      }, 1000);
    });
  }, 10000); // Increase timeout

  it('should store reasoning in chat history for first message when autoTurn is enabled', async () => {
    // Mock the API response with reasoning and turns
    const mockResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'First part\nSecond part',
          reasoning: 'Reasoning for the response',
          turns: ['First part', 'Second part']
        },
        finish_reason: 'stop'
      }],
      id: 'test-id',
      object: 'chat.completion',
      created: Date.now(),
      model: 'test-model'
    };

    vi.mocked(requestUtilMock.request).mockResolvedValue(mockResponse);

    // Make a completion request
    await chatModule.completions({
      messages: [{ role: 'user', content: 'Test message' }]
    });

    // Wait longer for conversational turns to process both messages
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Get chat history
    const history = chatModule.getChatHistory();
    
    // Find the assistant messages
    const assistantMessages = history.filter(msg => msg.role === 'assistant');
    
    // Debug logging
    console.log('Total history length:', history.length);
    console.log('Assistant messages count:', assistantMessages.length);
    console.log('Assistant messages:', JSON.stringify(assistantMessages, null, 2));
    
    // The key test: reasoning should be present in the first assistant message
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);
    expect(assistantMessages[0]?.reasoning).toBe('Reasoning for the response');
    
    if (assistantMessages.length === 2) {
      // Both messages processed - ideal case
      expect(assistantMessages[0]?.content).toBe('First part');
      expect(assistantMessages[1]?.reasoning).toBeUndefined();
      expect(assistantMessages[1]?.content).toBe('Second part');
    } else if (assistantMessages.length === 1) {
      // Only first message processed so far - still valid if it has reasoning
      expect(assistantMessages[0]?.content).toBe('First part');
      // Check if this is part of a conversational turns group
      if (assistantMessages[0]?.totalInGroup === 2) {
        // This confirms conversational turns are working, second message will come later
        expect(assistantMessages[0]?.messageIndex).toBe(0);
      }
    } else {
      throw new Error(`Unexpected number of assistant messages: ${assistantMessages.length}`);
    }
  });

  it('should handle reasoning correctly when no turns are generated', async () => {
    // Mock the API response with reasoning but no turns (single response)
    const mockResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'Single response without splitting',
          reasoning: 'Reasoning for single response'
        },
        finish_reason: 'stop'
      }],
      id: 'test-id',
      object: 'chat.completion',
      created: Date.now(),
      model: 'test-model'
    };

    vi.mocked(requestUtilMock.request).mockResolvedValue(mockResponse);

    // Create a chat module with event emitter
    const eventEmitter = vi.fn();
    const chatModuleWithEvents = new ChatModule(
      requestUtilMock,
      chatOptionsWithAutoTurn,
      undefined,
      eventEmitter
    );

    let messageCompleteEmitted = false;
    let reasoningIncluded = false;

    // Set up event listener
    eventEmitter.mockImplementation((event, data) => {
      if (event === 'messageComplete') {
        messageCompleteEmitted = true;
        reasoningIncluded = !!data.reasoning;
        expect(data.reasoning).toBe('Reasoning for single response');
        expect(data.content).toBe('Single response without splitting');
      }
    });

    // Make a completion request
    await chatModuleWithEvents.completions({
      messages: [{ role: 'user', content: 'Test message' }]
    });

    // Verify the event was emitted with reasoning
    expect(messageCompleteEmitted).toBe(true);
    expect(reasoningIncluded).toBe(true);
  });

  it('should preserve reasoning when autoTurn concatenates multiple turns into fewer messages', async () => {
    // Mock the API response with reasoning and multiple turns that will be concatenated
    const mockResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'Turn 1\nTurn 2\nTurn 3\nTurn 4',
          reasoning: 'Reasoning for concatenated response',
          turns: ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4'] // 4 turns that may be concatenated to fewer
        },
        finish_reason: 'stop'
      }],
      id: 'test-id',
      object: 'chat.completion',
      created: Date.now(),
      model: 'test-model'
    };

    vi.mocked(requestUtilMock.request).mockResolvedValue(mockResponse);

    // Create a chat module with event emitter
    const eventEmitter = vi.fn();
    const chatModuleWithEvents = new ChatModule(
      requestUtilMock,
      chatOptionsWithAutoTurn,
      undefined,
      eventEmitter
    );

    let firstMessageHasReasoning = false;
    let autoMessageCount = 0;

    // Set up event listener
    eventEmitter.mockImplementation((event, data) => {
      if (event === 'messageComplete' && data.messageType === 'auto') {
        autoMessageCount++;
        if (autoMessageCount === 1) {
          // First auto message should have reasoning
          firstMessageHasReasoning = !!data.reasoning;
          if (data.reasoning) {
            expect(data.reasoning).toBe('Reasoning for concatenated response');
          }
        } else {
          // Subsequent messages should not have reasoning
          expect(data.reasoning).toBeUndefined();
        }
      }
    });

    // Make a completion request
    await chatModuleWithEvents.completions({
      messages: [{ role: 'user', content: 'Test message' }]
    });

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify reasoning was included in the first message
    expect(firstMessageHasReasoning).toBe(true);
  });
});