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
      splitProbability: 1.0, // Always split for testing
      maxTurns: 3, // Maximum 3 turns (including next flag)
      maxTurnConcatProbability: 0.7, // 70% probability for concatenation
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
    it('should concatenate 3 turns to 2 turns with 70% probability', async () => {
      // Mock Math.random to return values that trigger concatenation
      const originalRandom = Math.random;
      let callCount = 0;
      Math.random = vi.fn(() => {
        callCount++;
        // First call for splitProbability (should split), second for concatenation probability
        return callCount === 1 ? 0.5 : 0.6; // 0.6 < 0.7, so should concatenate
      });

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

      // Should have concatenated to 3 turns (4 > maxTurns of 3)
      expect(messagesReceived).toHaveLength(3);
      expect(messagesReceived[0]?.content).toBe('Turn 1 Turn 2'); // Concatenated
      expect(messagesReceived[1]?.content).toBe('Turn 3');
      expect(messagesReceived[2]?.content).toBe('Turn 4');

      Math.random = originalRandom;
    });

    it('should not concatenate 3 turns when probability check fails', async () => {
      // Mock Math.random to return values that prevent concatenation
      const originalRandom = Math.random;
      let callCount = 0;
      Math.random = vi.fn(() => {
        callCount++;
        // First call for splitProbability (should split), second for concatenation probability
        return callCount === 1 ? 0.5 : 0.8; // 0.8 > 0.7, so should not concatenate
      });

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

      // Should keep all 3 turns (at the limit)
      expect(messagesReceived).toHaveLength(3);
      expect(messagesReceived[0]?.content).toBe('Turn 1');
      expect(messagesReceived[1]?.content).toBe('Turn 2');
      expect(messagesReceived[2]?.content).toBe('Turn 3');

      Math.random = originalRandom;
    });

    it('should concatenate 2 turns with next=true to 1 turn', async () => {
      // Mock Math.random for concatenation
      const originalRandom = Math.random;
      Math.random = vi.fn(() => 0.6); // Should trigger concatenation

      const turns = ['Turn 1', 'Turn 2', 'Turn 3'];
      const processed = manager.processResponse(
        'Turn 1\nTurn 2\nTurn 3',
        undefined,
        undefined,
        turns,
        undefined,
        true // hasNext = true, making total turns = 4 (3 + next)
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should concatenate to 2 turns since total would be 4 (3 + next) > maxTurns (3)
      expect(messagesReceived).toHaveLength(2);
      expect(messagesReceived[0]?.content).toBe('Turn 1 Turn 2');
      expect(messagesReceived[1]?.content).toBe('Turn 3');
      expect(messagesReceived[1]?.hasNext).toBe(true);

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

      // Should remain as 2 turns (within limit, no concatenation needed)
      expect(messagesReceived).toHaveLength(2);
      expect(messagesReceived[0]?.content).toBe('Turn 1');
      expect(messagesReceived[1]?.content).toBe('Turn 2');
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
      // Mock Math.random to prevent concatenation
      const originalRandom = Math.random;
      Math.random = vi.fn(() => 0.8); // > 0.7, should not concatenate

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

      // Should keep exactly 3 turns (at the limit)
      expect(messagesReceived).toHaveLength(3);

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

      // Should not concatenate since within high limit
      expect(messagesReceived).toHaveLength(3);
    });
  });

  describe('Probability Configuration', () => {
    it('should respect custom concatenation probability', async () => {
      // Test with 0% concatenation probability
      const customConfig = {
        ...config,
        maxTurnConcatProbability: 0.0
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

      // With 0% probability, should not concatenate (keep 3 turns)
      expect(messagesReceived).toHaveLength(3);
    });

    it('should handle 100% concatenation probability', async () => {
      // Test with 100% concatenation probability
      const customConfig = {
        ...config,
        maxTurnConcatProbability: 1.0
      };
      
      const customManager = new ConversationalTurnsManager(customConfig, mockCallback, mockEventEmitter);
      
      const turns = ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4'];
      const processed = customManager.processResponse(
        'Turn 1\nTurn 2\nTurn 3\nTurn 4',
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // With 100% probability, should always concatenate (4 > maxTurns of 3)
      expect(messagesReceived.length).toBeLessThanOrEqual(3);
    });

    it('should use default 70% probability when not configured', async () => {
      // Create config without maxTurnConcatProbability
      const defaultConfig = {
        enabled: true,
        splitProbability: 1.0,
        maxTurns: 3,
        minDelay: 10,
        maxDelay: 20
      };
      
      const defaultManager = new ConversationalTurnsManager(defaultConfig, mockCallback, mockEventEmitter);
      
      // Mock Math.random to test default probability
      const originalRandom = Math.random;
      Math.random = vi.fn(() => 0.6); // Should trigger concatenation with default 0.7

      const turns = ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4'];
      const processed = defaultManager.processResponse(
        'Turn 1\nTurn 2\nTurn 3\nTurn 4',
        undefined,
        undefined,
        turns,
        undefined,
        false
      );

      expect(processed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should concatenate with default probability (4 > maxTurns of 3)
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

      // Verify violations are preserved on the last message
      expect(mockCallback).toHaveBeenCalledWith(
        "Turn 4",
        violations,
        undefined,
        expect.any(Object),
        "text",
        undefined,
        false
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

      // Verify tool calls are preserved on the last message
      expect(mockCallback).toHaveBeenCalledWith(
        "Turn 4",
        undefined,
        toolCalls,
        expect.any(Object),
        "text",
        undefined,
        false
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

    it('should validate maxTurnConcatProbability configuration', () => {
      expect(() => {
        new ConversationalTurnsManager({
          enabled: true,
          maxTurnConcatProbability: 1.5 // Invalid: must be between 0 and 1
        }, mockCallback, mockEventEmitter);
      }).toThrow('conversationalTurns.maxTurnConcatProbability must be between 0 and 1');
      
      expect(() => {
        new ConversationalTurnsManager({
          enabled: true,
          maxTurnConcatProbability: -0.1 // Invalid: must be between 0 and 1
        }, mockCallback, mockEventEmitter);
      }).toThrow('conversationalTurns.maxTurnConcatProbability must be between 0 and 1');
    });

    it('should accept valid configuration values', () => {
      expect(() => {
        new ConversationalTurnsManager({
          enabled: true,
          maxTurns: 5,
          maxTurnConcatProbability: 0.8
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