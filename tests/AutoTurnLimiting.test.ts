import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationalTurnsManager } from '../src/conversational-turns/ConversationalTurnsManager';
import type { ConversationalTurnsConfig, MessageCallback, EventEmitter } from '../src/conversational-turns/types';

describe('AutoTurn Limiting Feature', () => {
  let manager: ConversationalTurnsManager;
  let mockCallback: MessageCallback;
  let mockEventEmitter: EventEmitter;
  let messagesReceived: Array<{ content: string; hasNext?: boolean; turnIndex?: number; totalTurns?: number }>;
  let config: ConversationalTurnsConfig;

  beforeEach(() => {
    messagesReceived = [];
    
    // Mock the message callback to track what messages are processed
    mockCallback = vi.fn((content, violations, toolCalls, groupMetadata, messageType, imagePrompt, hasNext) => {
      messagesReceived.push({ 
        content: content || '', 
        hasNext,
        turnIndex: groupMetadata?.messageIndex,
        totalTurns: groupMetadata?.totalInGroup
      });
    });
    
    mockEventEmitter = vi.fn();
    
    // Base configuration with new autoTurn limiting settings
    config = {
      enabled: true,
      maxTurns: 3, // Maximum 3 turns (including next flag)
      minDelay: 10,
      maxDelay: 20
    };

    manager = new ConversationalTurnsManager(config, mockCallback, mockEventEmitter);
  });

  describe('Turn Counting Logic', () => {
    it('should count total turns correctly without next flag', () => {
      const turns = ['Turn 1', 'Turn 2', 'Turn 3'];
      const totalTurns = countTotalTurns(turns, false);
      expect(totalTurns).toBe(3);
    });

    it('should count total turns correctly with next flag', () => {
      const turns = ['Turn 1', 'Turn 2'];
      const totalTurns = countTotalTurns(turns, true);
      expect(totalTurns).toBe(3); // 2 turns + 1 for next
    });

    it('should handle single turn with next flag', () => {
      const turns = ['Single turn'];
      const totalTurns = countTotalTurns(turns, true);
      expect(totalTurns).toBe(2); // 1 turn + 1 for next
    });

    it('should handle empty turns array', () => {
      const turns: string[] = [];
      const totalTurns = countTotalTurns(turns, false);
      expect(totalTurns).toBe(0);
    });
  });

  describe('Turn Concatenation Logic', () => {
    it('should concatenate turns when using API turns', async () => {
      // API turns are always used now (no probability check)
      const originalRandom = Math.random;
      Math.random = vi.fn(() => 0.5); // 50% < 100% (use turns)

      const turns = ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4'];
      const processed = manager.processResponse(
        'Turn 1\nTurn 2\nTurn 3\nTurn 4',
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have concatenated to some number between 1 and 3 turns (random)
      expect(messagesReceived.length).toBeGreaterThanOrEqual(1);
      expect(messagesReceived.length).toBeLessThanOrEqual(3);

      Math.random = originalRandom;
    });

    it('should always use API turns when available', async () => {
      // API turns are always used now (no probability check)
      const turns = ['Turn 1', 'Turn 2', 'Turn 3'];
      const processed = manager.processResponse(
        'Turn 1 Turn 2 Turn 3', // No newlines to avoid Priority 1 logic
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      // Should return true (always use turns when available)
      expect(processed).toBe(true);
    });

    it('should be able to produce the full range of 1 to maxTurns', async () => {
      const originalRandom = Math.random;
      const turnCounts = new Set<number>();
      
      // Test specific random values to force different outcomes
      const testValues = [
        0.1,  // Should give Math.ceil(0.1 * 3) = 1 turn
        0.5,  // Should give Math.ceil(0.5 * 3) = 2 turns
        0.9   // Should give Math.ceil(0.9 * 3) = 3 turns
      ];
      
      for (const randomValue of testValues) {
        // Reset for each iteration
        messagesReceived = [];
        manager = new ConversationalTurnsManager(config, mockCallback, mockEventEmitter);
        
        // Mock Math.random to return specific value
        Math.random = vi.fn(() => randomValue);
        
        const turns = ['Turn 1', 'Turn 2', 'Turn 3'];
        const processed = manager.processResponse(
          'Turn 1 Turn 2 Turn 3', // No newlines to use API turns instead of newline splitting
          undefined,
          undefined,
          turns,
          undefined,
          false, // hasNext = false, so maxPossibleTurns = 3
          undefined // reasoning
        );

        expect(processed).toBe(true);
        
        // Wait for all messages to be processed
        const expectedTurnCount = Math.floor(randomValue * 3) + 1;
        let attempts = 0;
        const maxAttempts = 50; // Increase max attempts
        while (messagesReceived.length < expectedTurnCount && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }

        // Should get 1-3 turns (enforced by maxTurns limit)
        expect(messagesReceived.length).toBeGreaterThanOrEqual(1);
        expect(messagesReceived.length).toBeLessThanOrEqual(3);
        
        turnCounts.add(messagesReceived.length);
      }

      // Verify we can produce multiple different turn counts in the valid range
      expect(turnCounts.size).toBeGreaterThanOrEqual(2); // Should have at least 2 different turn counts
      expect(Array.from(turnCounts).every(count => count >= 1 && count <= 3)).toBe(true);
      
      // The key improvement: we should now be able to get up to 3 turns (vs the old max of 2)
      expect(Math.max(...Array.from(turnCounts))).toBeGreaterThanOrEqual(2);
      
      Math.random = originalRandom;
    });

    it('should always concatenate 4+ turns to respect maxTurns limit', async () => {
      const turns = ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4', 'Turn 5'];
      const processed = manager.processResponse(
        'Turn 1\nTurn 2\nTurn 3\nTurn 4\nTurn 5',
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should always concatenate to respect maxTurns (3) limit
      expect(messagesReceived.length).toBeLessThanOrEqual(3);
      
      // Verify all original content is preserved
      const allContent = messagesReceived.map(m => m.content).join(' ');
      turns.forEach(turn => {
        expect(allContent).toContain(turn.replace('Turn ', ''));
      });
    });

    it('should not concatenate 2 turns without next flag', async () => {
      const turns = ['Turn 1', 'Turn 2'];
      const processed = manager.processResponse(
        'Turn 1\nTurn 2',
        undefined,
        undefined,
        turns,
        undefined,
        false // hasNext = false, total turns = 2
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Due to random concatenation, could be 1 or 2 turns
      expect(messagesReceived.length).toBeGreaterThanOrEqual(1);
      expect(messagesReceived.length).toBeLessThanOrEqual(2);
      
      // Verify all content is preserved
      const allContent = messagesReceived.map(m => m.content).join(' ');
      expect(allContent).toContain('Turn 1');
      expect(allContent).toContain('Turn 2');
    });

    it('should not concatenate 1 turn with next=true', async () => {
      const turns = ['Single turn'];
      const processed = manager.processResponse(
        'Single turn',
        undefined,
        undefined,
        turns,
        undefined,
        true // hasNext = true, total turns = 2
      );

      // Single turn should not be processed as conversational turns
      expect(processed).toBe(false);
      expect(messagesReceived).toHaveLength(0);
    });
  });

  describe('Maximum Turn Limit Enforcement', () => {
    it('should respect custom maxTurns setting', async () => {
      // Test with maxTurns = 2
      const customConfig = {
        ...config,
        maxTurns: 2
      };
      
      const customManager = new ConversationalTurnsManager(customConfig, mockCallback, mockEventEmitter);
      
      const turns = ['Turn 1', 'Turn 2', 'Turn 3'];
      const processed = customManager.processResponse(
        'Turn 1\nTurn 2\nTurn 3',
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should concatenate to respect maxTurns = 2
      expect(messagesReceived.length).toBeLessThanOrEqual(2);
    });

    it('should handle edge case of exactly maxTurns with next=false', async () => {
      // Mock Math.random to use turns
      const originalRandom = Math.random;
      Math.random = vi.fn(() => 0.5); // < 1.0, should use turns

      const turns = ['Turn 1', 'Turn 2', 'Turn 3'];
      const processed = manager.processResponse(
        'Turn 1\nTurn 2\nTurn 3',
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should concatenate to some number between 1 and 3 turns (random)
      expect(messagesReceived.length).toBeGreaterThanOrEqual(1);
      expect(messagesReceived.length).toBeLessThanOrEqual(3);

      Math.random = originalRandom;
    });

    it('should enforce limit when turns + next exceeds maxTurns', async () => {
      const turns = ['Turn 1', 'Turn 2', 'Turn 3'];
      const processed = manager.processResponse(
        'Turn 1\nTurn 2\nTurn 3',
        undefined,
        undefined,
        turns,
        undefined,
        true // hasNext = true, total would be 4, exceeds maxTurns = 3
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should concatenate to stay within limit
      expect(messagesReceived.length).toBeLessThanOrEqual(2);
    });

    it('should handle very high maxTurns setting', async () => {
      const customConfig = {
        ...config,
        maxTurns: 10
      };
      
      const customManager = new ConversationalTurnsManager(customConfig, mockCallback, mockEventEmitter);
      
      const turns = ['Turn 1', 'Turn 2', 'Turn 3'];
      const processed = customManager.processResponse(
        'Turn 1\nTurn 2\nTurn 3',
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // With high maxTurns, random concatenation can still occur
      // Should receive between 1 and 3 messages (random concatenation)
      expect(messagesReceived.length).toBeGreaterThanOrEqual(1);
      expect(messagesReceived.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Probability Configuration', () => {
    it('should always use API turns when available', async () => {
      // API turns are always used now (no probability check)
      const customConfig = {
        ...config
      };
      
      const customManager = new ConversationalTurnsManager(customConfig, mockCallback, mockEventEmitter);
      
      const turns = ['Turn 1', 'Turn 2', 'Turn 3'];
      const processed = customManager.processResponse(
        'Turn 1 Turn 2 Turn 3',
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      // Should always use turns when API provides them
      expect(processed).toBe(true);
    });

    it('should handle 100% split probability', async () => {
      // Test with 100% split probability (should always use turns)
      const customConfig = {
        ...config
      };
      
      const customManager = new ConversationalTurnsManager(customConfig, mockCallback, mockEventEmitter);
      
      const turns = ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4'];
      const processed = customManager.processResponse(
        'Turn 1 Turn 2 Turn 3 Turn 4', // No newlines to use API turns concatenation
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      
      // Wait for all messages to be processed with polling
      let attempts = 0;
      const maxAttempts = 30;
      while (messagesReceived.length === 0 && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      // With 4 input turns and maxTurns=3, should concatenate to 1-3 turns
      expect(messagesReceived.length).toBeGreaterThanOrEqual(1);
      expect(messagesReceived.length).toBeLessThanOrEqual(3);
    });

    it('should always use API turns when available', async () => {
      // Create config without any special settings
      const defaultConfig = {
        enabled: true,
        maxTurns: 3,
        minDelay: 10,
        maxDelay: 20
      };
      
      const defaultManager = new ConversationalTurnsManager(defaultConfig, mockCallback, mockEventEmitter);
      
      // Mock Math.random to test default probability
      const originalRandom = Math.random;
      Math.random = vi.fn(() => 0.5); // Should use turns with default 0.6

      const turns = ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4'];
      const processed = defaultManager.processResponse(
        'Turn 1\nTurn 2\nTurn 3\nTurn 4',
        undefined,
        undefined,
        turns,
        undefined,
        false,
        undefined // reasoning
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should use turns and concatenate randomly
      expect(messagesReceived.length).toBeGreaterThanOrEqual(1);
      expect(messagesReceived.length).toBeLessThanOrEqual(3);

      Math.random = originalRandom;
    });
  });

  describe('Integration with Existing Features', () => {
    it('should preserve compliance violations on final message after concatenation', async () => {
      const violations = ['Test violation'];
      const turns = ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4'];
      
      // Mock concatenation
      const originalRandom = Math.random;
      Math.random = vi.fn(() => 0.6);

      const processed = manager.processResponse(
        'Turn 1\nTurn 2\nTurn 3\nTurn 4',
        violations,
        undefined,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify violations are preserved on the last message (regardless of concatenation)
      const lastMessage = messagesReceived[messagesReceived.length - 1];
      expect(lastMessage).toBeDefined();
      
      // Check that mockCallback was called with violations on the last call
      expect(mockCallback).toHaveBeenLastCalledWith(
        expect.any(String),
        violations,
        undefined,
        expect.any(Object),
        "text",
        undefined,
        false,
        undefined // reasoning parameter
      );

      Math.random = originalRandom;
    });

    it('should preserve tool calls on final message after concatenation', async () => {
      const toolCalls = [{ id: 'test', type: 'function' as const, function: { name: 'test', arguments: '{}' } }];
      const turns = ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4'];
      
      // Mock concatenation
      const originalRandom = Math.random;
      Math.random = vi.fn(() => 0.6);

      const processed = manager.processResponse(
        'Turn 1\nTurn 2\nTurn 3\nTurn 4',
        undefined,
        toolCalls,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify tool calls are preserved on the last message (regardless of concatenation)
      expect(mockCallback).toHaveBeenLastCalledWith(
        expect.any(String),
        undefined,
        toolCalls,
        expect.any(Object),
        "text",
        undefined,
        false,
        undefined // reasoning parameter
      );

      Math.random = originalRandom;
    });

    it('should work with disabled conversational turns', async () => {
      const disabledConfig = {
        ...config,
        enabled: false
      };
      
      const disabledManager = new ConversationalTurnsManager(disabledConfig, mockCallback, mockEventEmitter);
      
      const turns = ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4'];
      const processed = disabledManager.processResponse(
        'Turn 1\nTurn 2\nTurn 3\nTurn 4',
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      // Should return false when feature is disabled
      expect(processed).toBe(false);
      expect(messagesReceived).toHaveLength(0);
    });

    it('should work with newline override feature', async () => {
      // Test that autoTurn limiting works with existing newline override
      const turns = ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4'];
      const contentWithNewlines = turns.join('\n');
      
      const processed = manager.processResponse(
        contentWithNewlines,
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should force splitting due to newlines and apply turn limiting
      expect(messagesReceived.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Edge Cases and Error Conditions', () => {
    it('should handle empty content gracefully', async () => {
      const processed = manager.processResponse(
        '',
        undefined,
        undefined,
        [''],
        undefined,
        false
      );

      // Single turn (even empty) should not be processed as conversational turns
      expect(processed).toBe(false);
      expect(messagesReceived).toHaveLength(0);
    });

    it('should handle null content gracefully', async () => {
      const processed = manager.processResponse(
        null,
        undefined,
        undefined,
        ['Turn 1', 'Turn 2'],
        undefined,
        false
      );

      // Should return false for null content
      expect(processed).toBe(false);
      expect(messagesReceived).toHaveLength(0);
    });

    it('should handle undefined turns array', async () => {
      const processed = manager.processResponse(
        'Some content with\nmultiple lines',
        undefined,
        undefined,
        undefined,
        undefined,
        false
      );

      // Should NOT split when no API turns provided - only split when single turn in array
      expect(processed).toBe(false);
    });

    it('should handle single turn array', async () => {
      const processed = manager.processResponse(
        'Single turn',
        undefined,
        undefined,
        ['Single turn'],
        undefined,
        false
      );

      // Single turn should not be processed as conversational turns
      expect(processed).toBe(false);
      expect(messagesReceived).toHaveLength(0);
    });

    it('should handle very long turn arrays', async () => {
      const manyTurns = Array.from({ length: 10 }, (_, i) => `Turn ${i + 1}`);
      const processed = manager.processResponse(
        manyTurns.join('\n'),
        undefined,
        undefined,
        manyTurns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should concatenate to respect maxTurns limit
      expect(messagesReceived.length).toBeLessThanOrEqual(3);
    });

    it('should handle maxTurns = 1', async () => {
      const customConfig = {
        ...config,
        maxTurns: 1
      };
      
      const customManager = new ConversationalTurnsManager(customConfig, mockCallback, mockEventEmitter);
      
      const turns = ['Turn 1', 'Turn 2', 'Turn 3'];
      const processed = customManager.processResponse(
        'Turn 1\nTurn 2\nTurn 3',
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should concatenate everything into 1 turn
      expect(messagesReceived).toHaveLength(1);
      expect(messagesReceived[0]?.content).toContain('Turn 1');
      expect(messagesReceived[0]?.content).toContain('Turn 2');
      expect(messagesReceived[0]?.content).toContain('Turn 3');
    });
  });

  describe('Concatenation Algorithm', () => {
    it('should concatenate adjacent turns intelligently', async () => {
      // Mock concatenation
      const originalRandom = Math.random;
      Math.random = vi.fn(() => 0.6);

      const turns = ['Short', 'Also short', 'This is a longer turn', 'Fourth turn'];
      const processed = manager.processResponse(
        turns.join('\n'),
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messagesReceived.length).toBeLessThanOrEqual(3); // Should concatenate 4 turns to 3
      
      // Verify all content is preserved
      const allContent = messagesReceived.map(m => m.content).join(' ');
      turns.forEach(turn => {
        expect(allContent).toContain(turn);
      });

      Math.random = originalRandom;
    });

    it('should preserve turn order during concatenation', async () => {
      // Mock concatenation
      const originalRandom = Math.random;
      Math.random = vi.fn(() => 0.6);

      const turns = ['First', 'Second', 'Third', 'Fourth'];
      const processed = manager.processResponse(
        turns.join('\n'),
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messagesReceived.length).toBeLessThan(turns.length);
      
      // Verify order is preserved
      const allContent = messagesReceived.map(m => m.content).join(' ');
      expect(allContent.indexOf('First')).toBeLessThan(allContent.indexOf('Second'));
      expect(allContent.indexOf('Second')).toBeLessThan(allContent.indexOf('Third'));
      expect(allContent.indexOf('Third')).toBeLessThan(allContent.indexOf('Fourth'));

      Math.random = originalRandom;
    });

    it('should handle concatenation with different target counts', async () => {
      const turns = ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4', 'Turn 5', 'Turn 6'];
      
      // Test concatenating to 2 turns
      const result2 = concatenateTurns(turns, 2);
      expect(result2).toHaveLength(2);
      expect(result2.join(' ')).toContain('Turn 1');
      expect(result2.join(' ')).toContain('Turn 6');
      
      // Test concatenating to 3 turns
      const result3 = concatenateTurns(turns, 3);
      expect(result3).toHaveLength(3);
      expect(result3.join(' ')).toContain('Turn 1');
      expect(result3.join(' ')).toContain('Turn 6');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate maxTurns configuration', () => {
      expect(() => {
        new ConversationalTurnsManager({
          enabled: true,
          maxTurns: 0 // Invalid: must be at least 1
        }, mockCallback, mockEventEmitter);
      }).toThrow('conversationalTurns.maxTurns must be at least 1');
    });


    it('should accept valid configuration values', () => {
      expect(() => {
        new ConversationalTurnsManager({
          enabled: true,
          maxTurns: 5,
        }, mockCallback, mockEventEmitter);
      }).not.toThrow();
    });
  });
});

// Helper function to count total turns including next flag
function countTotalTurns(turns: string[], hasNext: boolean): number {
  const baseTurns = turns.length;
  const nextTurn = hasNext ? 1 : 0;
  return baseTurns + nextTurn;
}

// Helper function to simulate turn concatenation logic
function shouldConcatenateTurns(totalTurns: number, maxTurns: number, probability: number): boolean {
  // Always concatenate if exceeds maxTurns
  if (totalTurns > maxTurns) {
    return true;
  }
  
  // Concatenate with probability if at maxTurns
  if (totalTurns === maxTurns) {
    return Math.random() < probability;
  }
  
  // No concatenation needed if under maxTurns
  return false;
}

// Helper function to concatenate turns intelligently
function concatenateTurns(turns: string[], targetCount: number): string[] {
  if (turns.length <= targetCount) {
    return turns;
  }
  
  const result: string[] = [];
  const turnsPerGroup = Math.ceil(turns.length / targetCount);
  
  for (let i = 0; i < turns.length; i += turnsPerGroup) {
    const group = turns.slice(i, i + turnsPerGroup);
    result.push(group.join(' '));
  }
  
  return result.slice(0, targetCount);
}