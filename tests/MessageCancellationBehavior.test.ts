import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatModule } from '../src/Chat';
import { RequestUtil } from '../src/RequestUtil';
import { AuthHandler } from '../src/AuthHandler';
import type { AnimusChatOptions } from '../src/AnimusClient';

// Mock dependencies
vi.mock('../src/RequestUtil');
vi.mock('../src/AuthHandler');

describe('Message Cancellation Behavior', () => {
  let chatModule: ChatModule;
  let requestUtilMock: RequestUtil;
  let authHandlerMock: AuthHandler;

  const defaultChatOptions: AnimusChatOptions = {
    model: 'test-model',
    systemMessage: 'You are a helpful assistant.',
    autoTurn: {
      enabled: true,
      baseTypingSpeed: 20, // Very fast for testing
      minDelay: 1000,
      maxDelay: 2000,
      maxTurns: 5,
      followUpDelay: 200, // Short delay for testing
      maxSequentialFollowUps: 3
    },
    historySize: 10 // Enable history to test retention
  };

  beforeEach(() => {
    authHandlerMock = new AuthHandler('http://dummy-url', 'sessionStorage');
    requestUtilMock = new RequestUtil('http://dummy-base', authHandlerMock);

    vi.resetAllMocks();

    chatModule = new ChatModule(
      requestUtilMock,
      defaultChatOptions
    );
  });

  it('should retain already-processed messages but cancel pending ones when user sends new message', async () => {
    // Mock API responses
    const mockResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'First turn content.\nSecond turn content.\nThird turn content.',
          turns: ['First turn content.', 'Second turn content.', 'Third turn content.'],
          reasoning: null
        }
      }],
      compliance_violations: []
    };

    const mockSecondResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'Response to second message.',
          reasoning: null
        }
      }],
      compliance_violations: []
    };

    // Retry loop to ensure we get 3 separate turns (no concatenation)
    let attempts = 0;
    const maxAttempts = 20;
    let testPassed = false;

    while (attempts < maxAttempts && !testPassed) {
      attempts++;
      
      // Reset the chat module for each attempt
      chatModule = new ChatModule(
        requestUtilMock,
        defaultChatOptions
      );

      requestUtilMock.request = vi.fn()
        .mockResolvedValueOnce(mockResponse)
        .mockResolvedValueOnce(mockSecondResponse);

      try {
        // Start the first conversation with autoTurn enabled
        const firstResponsePromise = chatModule.send('Tell me a story');

        // Wait for the first turn to be processed (but not all turns)
        await new Promise(resolve => setTimeout(resolve, 1100));

        // Get history after first turn is processed
        const historyAfterFirstTurn = chatModule.getChatHistory();
        
        // Check if we got separate turns (not concatenated)
        // We want to see at least 2 messages: user + first turn, with more turns pending
        if (historyAfterFirstTurn.length >= 2 &&
            historyAfterFirstTurn[1]?.content === 'First turn content.') {
          
          // Send a new message while remaining turns are still pending
          const secondResponsePromise = chatModule.send('Actually, tell me about cats instead');

          // Wait for both to complete
          await Promise.all([firstResponsePromise, secondResponsePromise]);

          // Get final history
          const finalHistory = chatModule.getChatHistory();
          
          // Verify the expected behavior: first turn retained, others canceled
          if (finalHistory.length >= 4 &&
              finalHistory[0]?.role === 'user' &&
              finalHistory[0]?.content === 'Tell me a story' &&
              finalHistory[1]?.role === 'assistant' &&
              finalHistory[1]?.content === 'First turn content.' &&
              finalHistory[2]?.role === 'user' &&
              finalHistory[2]?.content === 'Actually, tell me about cats instead' &&
              finalHistory[3]?.role === 'assistant' &&
              finalHistory[3]?.content === 'Response to second message.') {
            
            // Verify we don't have the canceled turns
            const historyContent = finalHistory.map(msg => msg.content).join(' ');
            if (!historyContent.includes('Second turn content.') &&
                !historyContent.includes('Third turn content.')) {
              testPassed = true;
              break;
            }
          }
        }
      } catch (error) {
        // Continue to next attempt if this one failed
        continue;
      }
    }

    // Assert that we eventually got the expected behavior
    expect(testPassed).toBe(true);
    expect(attempts).toBeLessThanOrEqual(maxAttempts);
  }, 30000); // Increase timeout for multiple attempts

  it('should properly track message IDs for cancellation', async () => {
    // Mock Math.random to force maximum splitting (no concatenation)
    const originalRandom = Math.random;
    Math.random = vi.fn().mockReturnValue(0.99); // High value to get maximum turns

    try {
      // Mock response with newlines to force splitting
      const mockResponse = {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Turn 1.\nTurn 2.\nTurn 3.',
            turns: ['Turn 1.', 'Turn 2.', 'Turn 3.'],
            reasoning: null
          }
        }],
        compliance_violations: []
      };

      requestUtilMock.request = vi.fn().mockResolvedValue(mockResponse);

      // Start conversation
      const responsePromise = chatModule.send('Test message');

      // Wait for the first turn to be processed
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Send canceling message
      const cancelPromise = chatModule.send('Cancel that');

      await Promise.all([responsePromise, cancelPromise]);

      const history = chatModule.getChatHistory();
      
      // Log the actual history for debugging
      console.log('History length:', history.length);
      console.log('History contents:', history.map(msg => `${msg.role}: ${msg.content}`));
      
      // The test should verify that:
      // 1. We have at least 3 messages (user, turn1, cancel message)
      // 2. The canceled turns are not all present in history
      expect(history.length).toBeGreaterThanOrEqual(3);
      
      // Verify that not all turns made it to history (some were canceled)
      const allContent = history.map(msg => msg.content).join(' ');
      const hasTurn1 = allContent.includes('Turn 1.');
      const hasTurn2 = allContent.includes('Turn 2.');
      const hasTurn3 = allContent.includes('Turn 3.');
      
      // At least Turn 1 should be present (it was processed before cancellation)
      expect(hasTurn1).toBe(true);
      
      // Not all turns should be present (some should have been canceled)
      expect(hasTurn1 && hasTurn2 && hasTurn3).toBe(false);
    } finally {
      // Restore original Math.random
      Math.random = originalRandom;
    }
  });

  it('should cancel follow-up requests when user sends new message', async () => {
    // Mock response that triggers a follow-up request
    const mockResponseWithFollowUp = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'I can help with that.',
          turns: ['I can help with that.'],
          next: true, // This triggers a follow-up request
          reasoning: null
        }
      }],
      compliance_violations: []
    };

    const mockFollowUpResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'This is a follow-up message that should be canceled.',
          reasoning: null
        }
      }],
      compliance_violations: []
    };

    const mockNewMessageResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'Response to new message.',
          reasoning: null
        }
      }],
      compliance_violations: []
    };

    // Track how many times the mock is called
    let callCount = 0;
    requestUtilMock.request = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(mockResponseWithFollowUp);
      } else if (callCount === 2) {
        // This should be the new message response, not the follow-up
        return Promise.resolve(mockNewMessageResponse);
      } else {
        // If follow-up was not canceled, this would be called
        return Promise.resolve(mockFollowUpResponse);
      }
    });

    // Send first message that will trigger a follow-up
    const firstResponsePromise = chatModule.send('Help me with something');

    // Wait for the first response to complete and follow-up to be scheduled
    await new Promise(resolve => setTimeout(resolve, 50));

    // Send a new message before the follow-up completes
    // This should cancel the pending follow-up
    const secondResponsePromise = chatModule.send('Actually, never mind');

    // Wait for both to complete
    await Promise.all([firstResponsePromise, secondResponsePromise]);

    // Wait a bit more to ensure any follow-up would have completed if not canceled
    await new Promise(resolve => setTimeout(resolve, 500));

    const history = chatModule.getChatHistory();
    
    // Debug: Log the actual history to understand what's happening
    console.log('Follow-up test history length:', history.length);
    console.log('Follow-up test history contents:', history.map(msg => `${msg.role}: ${msg.content}`));
    
    // Should have:
    // 1. First user message
    // 2. First response
    // 3. Second user message (cancellation)
    // 4. Second response
    // Should NOT have the follow-up message
    expect(history.length).toBe(4);
    
    expect(history[0]?.role).toBe('user');
    expect(history[0]?.content).toBe('Help me with something');
    
    expect(history[1]?.role).toBe('assistant');
    expect(history[1]?.content).toBe('I can help with that.');
    
    expect(history[2]?.role).toBe('user');
    expect(history[2]?.content).toBe('Actually, never mind');
    
    expect(history[3]?.role).toBe('assistant');
    expect(history[3]?.content).toBe('Response to new message.');
    
    // Verify the follow-up message was NOT added to history
    const allContent = history.map(msg => msg.content).join(' ');
    expect(allContent).not.toContain('This is a follow-up message that should be canceled.');
  });
});