import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatModule, ChatMessage } from '../src/Chat';
import { RequestUtil } from '../src/RequestUtil';
import { AuthHandler } from '../src/AuthHandler';
import type { AnimusChatOptions } from '../src/AnimusClient';

// Mock dependencies
vi.mock('../src/RequestUtil');
vi.mock('../src/AuthHandler');

describe('ChatModule Reasoning Support', () => {
  let chatModule: ChatModule;
  let requestUtilMock: RequestUtil;

  // Default config for tests with reasoning enabled
  const defaultChatOptions: AnimusChatOptions = {
    model: 'test-chat-model',
    systemMessage: 'Test system message',
    historySize: 10,
    reasoning: true // Enable reasoning
  };

  beforeEach(() => {
    // Create new instances for each test
    const authHandlerMock = new AuthHandler('http://dummy-url', 'sessionStorage');
    requestUtilMock = new RequestUtil('http://dummy-base', authHandlerMock);
    
    // Reset mocks
    vi.resetAllMocks();

    // Create fresh ChatModule instance
    chatModule = new ChatModule(
      requestUtilMock,
      defaultChatOptions
    );
  });

  it('should include reasoning in API request when enabled', async () => {
    // Mock the API response
    const mockResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'This is the response content',
          reasoning: 'This is the reasoning behind the response'
        },
        finish_reason: 'stop'
      }],
      id: 'test-id',
      object: 'chat.completion',
      created: Date.now(),
      model: 'test-model'
    };

    // Mock the request method
    vi.mocked(requestUtilMock.request).mockResolvedValue(mockResponse);

    // Make a completion request
    const result = await chatModule.completions({
      messages: [{ role: 'user', content: 'Test message' }]
    });

    // Verify the API was called with reasoning parameters
    expect(requestUtilMock.request).toHaveBeenCalledWith(
      'POST',
      '/chat/completions',
      expect.objectContaining({
        reasoning: true,
        show_reasoning: true
      }),
      false
    );

    // Verify the response contains reasoning
    expect(result.choices[0]!.message.reasoning).toBe('This is the reasoning behind the response');
  });

  it('should store reasoning in chat history', async () => {
    // Mock the API response with reasoning
    const mockResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'Response with reasoning',
          reasoning: 'The model thought about this carefully'
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

    // Get chat history
    const history = chatModule.getChatHistory();
    
    // Find the assistant message
    const assistantMessage = history.find(msg => msg.role === 'assistant');
    
    // Verify reasoning is stored
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage?.reasoning).toBe('The model thought about this carefully');
    expect(assistantMessage?.content).toBe('Response with reasoning');
  });

  it('should emit reasoning in messageComplete event', () => {
    return new Promise<void>((resolve, reject) => {
    // Mock the API response
    const mockResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'Response content',
          reasoning: 'Reasoning content'
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
      defaultChatOptions,
      undefined,
      eventEmitter
    );

    // Set up event listener
    eventEmitter.mockImplementation((event, data) => {
      if (event === 'messageComplete') {
        try {
          expect(data.reasoning).toBe('Reasoning content');
          expect(data.content).toBe('Response content');
          resolve();
        } catch (error) {
          reject(error);
        }
      }
    });

    // Make a completion request
    chatModuleWithEvents.completions({
      messages: [{ role: 'user', content: 'Test message' }]
    });
    });
  });

  it('should handle responses without reasoning gracefully', async () => {
    // Mock the API response without reasoning
    const mockResponse = {
      choices: [{
        message: {
          role: 'assistant',
          content: 'Response without reasoning'
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
    const result = await chatModule.completions({
      messages: [{ role: 'user', content: 'Test message' }]
    });

    // Verify the response works without reasoning
    expect(result.choices[0]!.message.content).toBe('Response without reasoning');
    expect(result.choices[0]!.message.reasoning).toBeUndefined();

    // Verify history doesn't have reasoning
    const history = chatModule.getChatHistory();
    const assistantMessage = history.find(msg => msg.role === 'assistant');
    expect(assistantMessage?.reasoning).toBeUndefined();
  });
});