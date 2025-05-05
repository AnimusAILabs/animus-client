import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatModule, ChatMessage } from '../src/Chat';
import { RequestUtil } from '../src/RequestUtil';
import { AuthHandler } from '../src/AuthHandler';
import type { AnimusChatOptions } from '../src/AnimusClient';

// Mock dependencies
vi.mock('../src/RequestUtil');
vi.mock('../src/AuthHandler');

describe('ChatModule History Management', () => {
  let chatModule: ChatModule;
  let requestUtilMock: RequestUtil;
  const mockIsObserverConnected = vi.fn(() => false);
  const mockSendObserverText = vi.fn(async () => { /* Default mock */ });

  // Default config for tests with history enabled
  const defaultChatOptions: AnimusChatOptions = {
    model: 'test-chat-model',
    systemMessage: 'Test system message',
    historySize: 10 // Enable history with a decent size
  };

  // Sample messages for testing
  const userMessage1: ChatMessage = { role: 'user', content: 'Hello' };
  const assistantMessage1: ChatMessage = { role: 'assistant', content: 'Hi there!' };
  const userMessage2: ChatMessage = { role: 'user', content: 'How are you?' };
  const assistantMessage2: ChatMessage = { role: 'assistant', content: 'I am fine, thank you!' };

  beforeEach(() => {
    // Create new instances for each test
    const authHandlerMock = new AuthHandler('http://dummy-url', 'sessionStorage');
    requestUtilMock = new RequestUtil('http://dummy-base', authHandlerMock);
    
    // Reset mocks
    vi.resetAllMocks();
    mockIsObserverConnected.mockReturnValue(false);
    mockSendObserverText.mockClear();

    // Create fresh ChatModule instance
    chatModule = new ChatModule(
      requestUtilMock,
      defaultChatOptions,
      mockIsObserverConnected,
      mockSendObserverText
    );
    
    // Add some initial messages for testing
    // We're using private methods here for testing, hence the type casting
    (chatModule as any).addMessageToHistory(userMessage1);
    (chatModule as any).addMessageToHistory(assistantMessage1);
  });

  it('should get chat history', () => {
    const history = chatModule.getChatHistory();
    
    // Verify history content
    expect(history).toHaveLength(2);
    expect(history[0]!.role).toBe('user');
    expect(history[0]!.content).toBe('Hello');
    expect(history[1]!.role).toBe('assistant');
    expect(history[1]!.content).toBe('Hi there!');
    
    // Verify it's a deep copy (modifying returned history shouldn't affect internal state)
    history[0]!.content = 'Modified!'; // Add non-null assertion
    const newHistory = chatModule.getChatHistory();
    expect(newHistory[0]!.content).toBe('Hello'); // Original still intact // Add non-null assertion
  });

  it('should set chat history with validation', () => {
    // Explicitly type the array
    const newHistory: ChatMessage[] = [
      userMessage2,
      assistantMessage2,
      { role: 'user', content: 'Another question' }
    ];
    
    // Replace history
    const count = chatModule.setChatHistory(newHistory);
    expect(count).toBe(3);
    
    // Verify new history
    const retrievedHistory = chatModule.getChatHistory();
    expect(retrievedHistory).toHaveLength(3);
    expect(retrievedHistory[0]!.role).toBe('user'); // Add non-null assertion
    expect(retrievedHistory[0]!.content).toBe('How are you?'); // Add non-null assertion
    expect(retrievedHistory[2]!.content).toBe('Another question'); // Add non-null assertion
  });

  it('should update history message', () => {
    // Update the first message (index 0)
    const success = chatModule.updateHistoryMessage(0, {
      content: 'Updated content',
      name: 'TestUser'
    });
    
    expect(success).toBe(true);
    
    // Verify update
    const history = chatModule.getChatHistory();
    expect(history[0]!.content).toBe('Updated content'); // Add non-null assertion
    expect(history[0]!.name).toBe('TestUser'); // Add non-null assertion
    expect(history[0]!.role).toBe('user'); // Role preserved // Add non-null assertion
  });

  it('should handle assistant message updates with thought tags', () => {
    // Update assistant message with thought tags
    const success = chatModule.updateHistoryMessage(1, {
      content: 'Updated <think>This is a reasoning block</think> response'
    });
    
    expect(success).toBe(true);
    
    // Verify cleaned content and extracted reasoning
    const history = chatModule.getChatHistory();
    expect(history[1]!.content).toBe('Updated response'); // Thought tag removed // Add non-null assertion
    expect(history[1]!.reasoning).toBe('This is a reasoning block'); // Reasoning extracted // Add non-null assertion
  });

  it('should delete history message', () => {
    // Delete the first message
    const success = chatModule.deleteHistoryMessage(0);
    expect(success).toBe(true);
    
    // Verify deletion
    const history = chatModule.getChatHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.role).toBe('assistant'); // Add non-null assertion
    expect(history[0]!.content).toBe('Hi there!'); // Add non-null assertion
  });

  it('should clear chat history', () => {
    // Clear history
    const count = chatModule.clearChatHistory();
    expect(count).toBe(2); // 2 messages were cleared
    
    // Verify empty history
    const history = chatModule.getChatHistory();
    expect(history).toHaveLength(0);
  });

  it('should reject invalid updates', () => {
    // Try to update with invalid role
    const invalidRoleUpdate = chatModule.updateHistoryMessage(0, {
      role: 'system' as any // Trying to change user to system (not allowed)
    });
    expect(invalidRoleUpdate).toBe(false);
    
    // Try to update non-existent index
    const invalidIndexUpdate = chatModule.updateHistoryMessage(99, {
      content: 'This should fail'
    });
    expect(invalidIndexUpdate).toBe(false);
    
    // Original messages should be unchanged
    const history = chatModule.getChatHistory();
    expect(history).toHaveLength(2);
    expect(history[0]!.role).toBe('user'); // Add non-null assertion
    expect(history[0]!.content).toBe('Hello'); // Add non-null assertion
  });

  it('should not affect history when historySize is 0', () => {
    // Create new ChatModule with history disabled
    const noHistoryChatModule = new ChatModule(
      requestUtilMock,
      {
        ...defaultChatOptions,
        historySize: 0 // Disable history
      },
      mockIsObserverConnected,
      mockSendObserverText
    );
    
    // Try to set history
    const setResult = noHistoryChatModule.setChatHistory([userMessage1]);
    expect(setResult).toBe(0); // No messages set
    
    // Try to get history
    const history = noHistoryChatModule.getChatHistory();
    expect(history).toHaveLength(0);
    
    // Update should fail
    const updateResult = noHistoryChatModule.updateHistoryMessage(0, { content: 'Test' });
    expect(updateResult).toBe(false);
    
    // Delete should fail
    const deleteResult = noHistoryChatModule.deleteHistoryMessage(0);
    expect(deleteResult).toBe(false);
  });
});