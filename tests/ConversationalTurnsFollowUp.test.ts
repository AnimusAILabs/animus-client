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

      // Due to random concatenation, we might get 1 or 2 messages
      expect(messagesReceived.length).toBeGreaterThanOrEqual(1);
      expect(messagesReceived.length).toBeLessThanOrEqual(2);
      
      // Verify all content is preserved
      const allContent = messagesReceived.map(m => m.content).join(' ');
      expect(allContent).toContain('Hey there!');
      expect(allContent).toContain('How are you doing today?');

      // Verify that hasNext is set on the last message
      const lastMessage = messagesReceived[messagesReceived.length - 1];
      expect(lastMessage?.hasNext).toBe(true);

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

      // Due to random concatenation, we might get 1 or 2 messages
      expect(messagesReceived.length).toBeGreaterThanOrEqual(1);
      expect(messagesReceived.length).toBeLessThanOrEqual(2);

      // Verify that hasNext is false on the last message (if any)
      const lastMessage = messagesReceived[messagesReceived.length - 1];
      if (lastMessage) {
        expect(lastMessage.hasNext).toBe(false);
      }

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

      // Due to random concatenation, we might get 1 or 2 messages
      expect(messagesReceived.length).toBeGreaterThanOrEqual(1);
      expect(messagesReceived.length).toBeLessThanOrEqual(2);

      // Verify that hasNext is not set on any message
      messagesReceived.forEach(msg => {
        expect(msg.hasNext).toBeUndefined();
      });

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

      // Due to random concatenation, we might get fewer messages than expected
      // Each group can be 1-2 messages, so total could be 2-4 messages
      expect(messagesReceived.length).toBeGreaterThanOrEqual(2);
      expect(messagesReceived.length).toBeLessThanOrEqual(4);

      // Count messages with hasNext: true (should be 2, one per group)
      const messagesWithNext = messagesReceived.filter(msg => msg.hasNext === true);
      expect(messagesWithNext).toHaveLength(2);

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

  describe('Sequential Follow-up Limiting', () => {
    it('should limit sequential follow-ups to maximum of 2', async () => {
      // This test simulates the behavior at the Chat.ts level where sequential follow-ups are limited
      let sequentialFollowUpCount = 0;
      const maxSequentialFollowUps = 2;
      let justGeneratedImage = false;

      // Mock the follow-up logic that would be in Chat.ts
      const simulateFollowUpLogic = (hasNext: boolean, isImageGenerated: boolean = false) => {
        if (isImageGenerated) {
          justGeneratedImage = true;
        }

        if (hasNext) {
          if (justGeneratedImage) {
            // Skip follow-up if we just generated an image
            justGeneratedImage = false;
            return false;
          } else if (sequentialFollowUpCount >= maxSequentialFollowUps) {
            // Skip follow-up if we've reached the limit
            return false;
          } else {
            // Allow follow-up and increment counter
            sequentialFollowUpCount++;
            return true;
          }
        }
        return false;
      };

      // Simulate user sending a message (resets counter)
      const simulateUserMessage = () => {
        sequentialFollowUpCount = 0;
        justGeneratedImage = false;
      };

      // Test scenario: Multiple sequential follow-ups
      simulateUserMessage(); // User sends initial message

      // First follow-up (should be allowed)
      expect(simulateFollowUpLogic(true)).toBe(true);
      expect(sequentialFollowUpCount).toBe(1);

      // Second follow-up (should be allowed)
      expect(simulateFollowUpLogic(true)).toBe(true);
      expect(sequentialFollowUpCount).toBe(2);

      // Third follow-up (should be blocked - reached limit)
      expect(simulateFollowUpLogic(true)).toBe(false);
      expect(sequentialFollowUpCount).toBe(2); // Should not increment

      // Fourth follow-up (should still be blocked)
      expect(simulateFollowUpLogic(true)).toBe(false);
      expect(sequentialFollowUpCount).toBe(2);

      // User sends new message (resets counter)
      simulateUserMessage();
      expect(sequentialFollowUpCount).toBe(0);

      // Follow-up after user message (should be allowed again)
      expect(simulateFollowUpLogic(true)).toBe(true);
      expect(sequentialFollowUpCount).toBe(1);
    });

    it('should block follow-ups after image generation', async () => {
      let sequentialFollowUpCount = 0;
      let justGeneratedImage = false;

      const simulateFollowUpLogic = (hasNext: boolean, isImageGenerated: boolean = false) => {
        if (isImageGenerated) {
          justGeneratedImage = true;
        }

        if (hasNext) {
          if (justGeneratedImage) {
            justGeneratedImage = false;
            return false;
          } else {
            sequentialFollowUpCount++;
            return true;
          }
        }
        return false;
      };

      // Normal follow-up (should be allowed)
      expect(simulateFollowUpLogic(true)).toBe(true);
      expect(sequentialFollowUpCount).toBe(1);

      // Follow-up after image generation (should be blocked)
      expect(simulateFollowUpLogic(true, true)).toBe(false);
      expect(sequentialFollowUpCount).toBe(1); // Should not increment
      expect(justGeneratedImage).toBe(false); // Should be reset

      // Next follow-up (should be allowed again)
      expect(simulateFollowUpLogic(true)).toBe(true);
      expect(sequentialFollowUpCount).toBe(2);
    });
  });
});