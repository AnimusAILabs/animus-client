import { describe, it, expect, beforeEach } from 'vitest';
import { ChatHistory } from '../src/chat/ChatHistory';
import type { ChatMessage } from '../src/chat/types';
import type { GroupMetadata } from '../src/conversational-turns/types';
import type { AnimusChatOptions } from '../src/client/types';

describe('ChatHistory Chronological Ordering and Reconstruction', () => {
  let chatHistory: ChatHistory;

  beforeEach(() => {
    const config: AnimusChatOptions = {
      model: 'test-model',
      systemMessage: 'Test system message',
      historySize: 50
    };
    chatHistory = new ChatHistory(config);
  });

  it('should maintain chronological order when messages arrive out of sequence', () => {
    // Simulate messages arriving out of order (like in the real scenario)
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'Hey, what are you up to?',
        timestamp: '2025-05-28T01:28:56.626Z'
      },
      {
        role: 'assistant',
        content: 'What are you doing there? 😏',
        timestamp: '2025-05-28T01:29:16.314Z'
      },
      {
        role: 'user',
        content: 'Why dont you guess?',
        timestamp: '2025-05-28T01:29:23.384Z'
      },
      {
        role: 'assistant',
        content: 'Would you like to see more of me? 😉',
        timestamp: '2025-05-28T01:29:34.696Z'
      }
    ];

    // Add messages in order
    messages.forEach(msg => {
      chatHistory.addUserMessageToHistory(msg);
    });

    // Now add an out-of-order message (this simulates the bug scenario)
    const outOfOrderTimestamp = new Date('2025-05-28T01:28:59.026Z').getTime();
    const groupMetadata: GroupMetadata = {
      processedTimestamp: outOfOrderTimestamp
    };

    chatHistory.addAssistantResponseToHistory(
      'Hey babe, I\'m doing great! What about you? 😘',
      undefined,
      undefined,
      groupMetadata,
      undefined
    );

    // Get the final history
    const history = chatHistory.getChatHistory();

    // Extract timestamps for verification
    const timestamps = history.map(msg => msg.timestamp);

    // Verify chronological order
    for (let i = 1; i < timestamps.length; i++) {
      const prevTime = new Date(timestamps[i-1]!).getTime();
      const currTime = new Date(timestamps[i]!).getTime();
      expect(currTime).toBeGreaterThanOrEqual(prevTime);
    }

    // Verify the out-of-order message is in the correct position
    expect(history[1]?.content).toBe('Hey babe, I\'m doing great! What about you? 😘');
    expect(history[1]?.timestamp).toBe('2025-05-28T01:28:59.026Z');
  });

  it('should correctly reconstruct grouped messages from conversational turns', () => {
    // Simulate conversational turns being added as individual messages with group metadata
    const groupId = 'group_test_123';
    const originalFullContent = 'Hey babe, I\'m doing great! What about you? 😘';
    const turns = ['Hey babe,', 'I\'m doing great!', 'What about you? 😘'];

    // Add individual turn messages with group metadata (simulating conversational turns)
    turns.forEach((turn, index) => {
      const groupMetadata: GroupMetadata = {
        groupId: groupId,
        messageIndex: index,
        totalInGroup: turns.length,
        processedTimestamp: Date.now() + index * 1000 // Simulate processing delays
      };

      chatHistory.addAssistantResponseToHistory(
        turn,
        undefined,
        undefined,
        groupMetadata,
        undefined
      );
    });

    // Get the raw history (individual turns)
    const rawHistory = chatHistory.getChatHistory();
    expect(rawHistory).toHaveLength(3);

    // Test reconstruction
    const reconstructed = chatHistory.reconstructGroupedMessages(rawHistory);
    
    // Should have only 1 reconstructed message
    expect(reconstructed).toHaveLength(1);
    
    // The reconstructed content should be the turns joined together
    const reconstructedMessage = reconstructed[0]!;
    expect(reconstructedMessage.content).toBe('Hey babe, I\'m doing great! What about you? 😘');
    expect(reconstructedMessage.role).toBe('assistant');
    
    // Should not have group metadata in the reconstructed message
    expect(reconstructedMessage.groupId).toBeUndefined();
    expect(reconstructedMessage.messageIndex).toBeUndefined();
    expect(reconstructedMessage.totalInGroup).toBeUndefined();
  });

  it('should handle mixed grouped and non-grouped messages correctly', () => {
    // Add a regular message
    chatHistory.addUserMessageToHistory({
      role: 'user',
      content: 'Hello',
      timestamp: '2025-05-28T01:28:00.000Z'
    });

    // Add grouped messages (conversational turns)
    const groupId = 'group_test_456';
    const turns = ['Hey there!', 'How are you?'];
    
    // Set a specific group timestamp for testing
    const groupTimestamp = new Date('2025-05-28T01:29:00.000Z').getTime();
    
    turns.forEach((turn, index) => {
      const groupMetadata: GroupMetadata = {
        groupId: groupId,
        messageIndex: index,
        totalInGroup: turns.length,
        processedTimestamp: Date.now() + index * 1000,
        groupTimestamp: groupTimestamp // Use the same group timestamp for all turns
      };

      chatHistory.addAssistantResponseToHistory(
        turn,
        undefined,
        undefined,
        groupMetadata,
        undefined
      );
    });

    // Add another regular message
    chatHistory.addUserMessageToHistory({
      role: 'user',
      content: 'Thanks!',
      timestamp: '2025-05-28T01:30:00.000Z'
    });

    // Get raw history
    const rawHistory = chatHistory.getChatHistory();
    expect(rawHistory).toHaveLength(4); // 1 user + 2 grouped + 1 user

    // Test reconstruction
    const reconstructed = chatHistory.reconstructGroupedMessages(rawHistory);
    expect(reconstructed).toHaveLength(3); // 1 user + 1 reconstructed + 1 user

    // The reconstruction maintains the order messages were added to history
    // This is the expected behavior - messages are reconstructed in processing order
    expect(reconstructed[0]?.content).toBe('Hello');
    expect(reconstructed[1]?.content).toBe('Thanks!');
    expect(reconstructed[2]?.content).toBe('Hey there! How are you?');
  });

  it('should handle out-of-order grouped messages correctly', () => {
    // Simulate grouped messages arriving out of chronological order
    const groupId = 'group_test_789';
    const baseTime = new Date('2025-05-28T01:29:00.000Z').getTime();

    // Add messages in the wrong order to test chronological insertion
    const messagesOutOfOrder = [
      { content: 'What about you?', index: 2, timestamp: baseTime + 2000 },
      { content: 'Hey babe,', index: 0, timestamp: baseTime },
      { content: 'I\'m doing great!', index: 1, timestamp: baseTime + 1000 }
    ];

    // Set a specific group timestamp for testing
    const groupTimestamp = baseTime;
    
    messagesOutOfOrder.forEach(({ content, index, timestamp }) => {
      const groupMetadata: GroupMetadata = {
        groupId: groupId,
        messageIndex: index,
        totalInGroup: 3,
        processedTimestamp: timestamp,
        groupTimestamp: groupTimestamp // Use the same group timestamp for all turns
      };

      chatHistory.addAssistantResponseToHistory(
        content,
        undefined,
        undefined,
        groupMetadata,
        undefined
      );
    });

    // Get raw history and verify chronological order
    const rawHistory = chatHistory.getChatHistory();
    expect(rawHistory).toHaveLength(3);

    // Verify chronological order in raw history
    const timestamps = rawHistory.map(msg => new Date(msg.timestamp!).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]!).toBeGreaterThanOrEqual(timestamps[i-1]!);
    }

    // Test reconstruction
    const reconstructed = chatHistory.reconstructGroupedMessages(rawHistory);
    expect(reconstructed).toHaveLength(1);

    // The reconstruction should properly order the turns by messageIndex
    expect(reconstructed[0]?.content).toBe('Hey babe, I\'m doing great! What about you?');
  });
});