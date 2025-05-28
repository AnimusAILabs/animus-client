import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationalTurnsManager } from '../src/conversational-turns/ConversationalTurnsManager';
import type { ConversationalTurnsConfig } from '../src/conversational-turns/types';

describe('Follow-up Request Handling', () => {
  let conversationalTurnsManager: ConversationalTurnsManager;
  let messageCallbackSpy: any;
  let followUpCallCount: number;
  let messagesReceived: Array<{ content: string; hasNext?: boolean }>;

  beforeEach(() => {
    followUpCallCount = 0;
    messagesReceived = [];

    // Mock the message callback to track what messages are processed
    messageCallbackSpy = vi.fn((content, violations, toolCalls, groupMetadata, messageType, imagePrompt, hasNext) => {
      messagesReceived.push({ content, hasNext });
      
      // Simulate the follow-up logic from Chat.ts
      if (hasNext) {
        followUpCallCount++;
      }
    });

    const config: ConversationalTurnsConfig = {
      enabled: true,
      splitProbability: 1.0, // Always split for testing
      minDelay: 10,
      maxDelay: 20
    };

    conversationalTurnsManager = new ConversationalTurnsManager(
      config,
      messageCallbackSpy
    );
  });

  describe('Multi-turn Conversational Responses', () => {
    it('should trigger follow-up only once for multi-turn response with hasNext: true', async () => {
      // Process a response with multiple turns and hasNext: true
      const processed = conversationalTurnsManager.processResponse(
        'Hey there! How are you doing today?',
        undefined, // compliance_violations
        undefined, // tool_calls
        ['Hey there!', 'How are you doing today?'], // turns
        undefined, // imagePrompt
        true // hasNext
      );

      expect(processed).toBe(true);

      // Wait for all messages to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify that we received the expected number of messages
      expect(messagesReceived).toHaveLength(2);
      expect(messagesReceived[0]?.content).toBe('Hey there!');
      expect(messagesReceived[1]?.content).toBe('How are you doing today?');

      // Verify that hasNext is only set on the last message
      expect(messagesReceived[0]?.hasNext).toBeUndefined();
      expect(messagesReceived[1]?.hasNext).toBe(true);

      // Verify that follow-up was triggered exactly once
      expect(followUpCallCount).toBe(1);
    });

    it('should not trigger follow-up for multi-turn response with hasNext: false', async () => {
      // Process a response with multiple turns and hasNext: false
      const processed = conversationalTurnsManager.processResponse(
        'Hey there! How are you doing today?',
        undefined, // compliance_violations
        undefined, // tool_calls
        ['Hey there!', 'How are you doing today?'], // turns
        undefined, // imagePrompt
        false // hasNext
      );

      expect(processed).toBe(true);

      // Wait for all messages to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify that we received the expected number of messages
      expect(messagesReceived).toHaveLength(2);

      // Verify that hasNext is not set on any message
      expect(messagesReceived[0]?.hasNext).toBeUndefined();
      expect(messagesReceived[1]?.hasNext).toBe(false);

      // Verify that follow-up was not triggered
      expect(followUpCallCount).toBe(0);
    });

    it('should not trigger follow-up for multi-turn response with hasNext: undefined', async () => {
      // Process a response with multiple turns and hasNext: undefined
      const processed = conversationalTurnsManager.processResponse(
        'Hey there! How are you doing today?',
        undefined, // compliance_violations
        undefined, // tool_calls
        ['Hey there!', 'How are you doing today?'], // turns
        undefined, // imagePrompt
        undefined // hasNext
      );

      expect(processed).toBe(true);

      // Wait for all messages to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify that we received the expected number of messages
      expect(messagesReceived).toHaveLength(2);

      // Verify that hasNext is not set on any message
      expect(messagesReceived[0]?.hasNext).toBeUndefined();
      expect(messagesReceived[1]?.hasNext).toBeUndefined();

      // Verify that follow-up was not triggered
      expect(followUpCallCount).toBe(0);
    });

    it('should handle multiple separate turn groups correctly', async () => {
      // Process first group with hasNext: true
      conversationalTurnsManager.processResponse(
        'First group message',
        undefined,
        undefined,
        ['First', 'group'],
        undefined,
        true
      );

      // Process second group with hasNext: true
      conversationalTurnsManager.processResponse(
        'Second group message',
        undefined,
        undefined,
        ['Second', 'group'],
        undefined,
        true
      );

      // Wait for all messages to be processed
      await new Promise(resolve => setTimeout(resolve, 150));

      // Verify that we received messages from both groups
      expect(messagesReceived).toHaveLength(4);

      // Verify that hasNext is only set on the last message of each group
      expect(messagesReceived[0]?.hasNext).toBeUndefined(); // First group, first message
      expect(messagesReceived[1]?.hasNext).toBe(true);      // First group, last message
      expect(messagesReceived[2]?.hasNext).toBeUndefined(); // Second group, first message
      expect(messagesReceived[3]?.hasNext).toBe(true);      // Second group, last message

      // Verify that follow-up was triggered exactly twice (once per group)
      expect(followUpCallCount).toBe(2);
    });
  });

  describe('Single-turn Responses', () => {
    it('should not process single turn as conversational turns', async () => {
      // Process a response with single turn - should not be processed as conversational turns
      const processed = conversationalTurnsManager.processResponse(
        'Single message',
        undefined, // compliance_violations
        undefined, // tool_calls
        ['Single message'], // turns (single turn)
        undefined, // imagePrompt
        true // hasNext
      );

      // Single turns should return false (not processed as conversational turns)
      expect(processed).toBe(false);

      // Wait for any potential async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify that no messages were processed through conversational turns
      expect(messagesReceived).toHaveLength(0);

      // Verify that follow-up was not triggered through conversational turns
      // (would be handled by regular Chat.ts processing instead)
      expect(followUpCallCount).toBe(0);
    });

    it('should not process response without turns array', async () => {
      // Process a response without turns array - should not be processed as conversational turns
      const processed = conversationalTurnsManager.processResponse(
        'Regular single response',
        undefined, // compliance_violations
        undefined, // tool_calls
        undefined, // turns (no turns array)
        undefined, // imagePrompt
        true // hasNext
      );

      // Should return false (not processed as conversational turns)
      expect(processed).toBe(false);

      // Wait for any potential async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify that no messages were processed through conversational turns
      expect(messagesReceived).toHaveLength(0);

      // Verify that follow-up was not triggered through conversational turns
      // (would be handled by regular Chat.ts processing instead)
      expect(followUpCallCount).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty turns array', async () => {
      // Process a response with empty turns array
      const processed = conversationalTurnsManager.processResponse(
        'Some content',
        undefined, // compliance_violations
        undefined, // tool_calls
        [], // turns (empty array)
        undefined, // imagePrompt
        true // hasNext
      );

      // Should return false (not processed as conversational turns)
      expect(processed).toBe(false);

      // Verify that no messages were processed
      expect(messagesReceived).toHaveLength(0);
      expect(followUpCallCount).toBe(0);
    });

    it('should handle disabled conversational turns', async () => {
      // Create a new manager with disabled conversational turns
      const disabledConfig: ConversationalTurnsConfig = {
        enabled: false,
        splitProbability: 1.0,
        minDelay: 10,
        maxDelay: 20
      };

      const disabledManager = new ConversationalTurnsManager(
        disabledConfig,
        messageCallbackSpy
      );

      // Process a response with multiple turns
      const processed = disabledManager.processResponse(
        'Hey there! How are you doing today?',
        undefined,
        undefined,
        ['Hey there!', 'How are you doing today?'],
        undefined,
        true
      );

      // Should return false (feature disabled)
      expect(processed).toBe(false);

      // Verify that no messages were processed
      expect(messagesReceived).toHaveLength(0);
      expect(followUpCallCount).toBe(0);
    });
  });
});