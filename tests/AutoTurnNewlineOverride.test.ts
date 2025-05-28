import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationalTurnsManager } from '../src/conversational-turns/ConversationalTurnsManager';
import type { ConversationalTurnsConfig, MessageCallback, EventEmitter } from '../src/conversational-turns/types';

describe('AutoTurn Newline Override', () => {
  let manager: ConversationalTurnsManager;
  let mockCallback: MessageCallback;
  let mockEventEmitter: EventEmitter;
  let config: ConversationalTurnsConfig;

  beforeEach(() => {
    mockCallback = vi.fn();
    mockEventEmitter = vi.fn();
    
    config = {
      enabled: true,
      splitProbability: 0.0, // Set to 0 so normally no splitting would occur
      shortSentenceThreshold: 30,
      baseTypingSpeed: 45,
      speedVariation: 0.2,
      minDelay: 800,
      maxDelay: 4000
    };

    manager = new ConversationalTurnsManager(config, mockCallback, mockEventEmitter);
  });

  it('should force splitting when content contains newlines and API turns are available', () => {
    const contentWithNewlines = "First line\nSecond line\nThird line";
    const apiTurns = ["First line", "Second line", "Third line"];
    
    // With splitProbability = 0, this would normally return false
    // But with newlines and API turns, it should force splitting
    const result = manager.processResponse(
      contentWithNewlines,
      undefined,
      undefined,
      apiTurns
    );

    expect(result).toBe(true); // Should return true indicating splitting was applied
  });

  it('should force splitting when content contains newlines and client-side splitter is available', () => {
    const contentWithNewlines = "First sentence.\nSecond sentence.\nThird sentence.";
    
    // No API turns provided, but splitter should handle it
    const result = manager.processResponse(
      contentWithNewlines,
      undefined,
      undefined,
      undefined // No API turns
    );

    expect(result).toBe(true); // Should return true indicating splitting was applied
  });

  it('should not force splitting when content has newlines but no split turns available', () => {
    // Create manager without splitter capability
    const noSplitterConfig = { ...config };
    const managerWithoutSplitter = new ConversationalTurnsManager(
      noSplitterConfig, 
      mockCallback, 
      mockEventEmitter
    );

    const contentWithNewlines = "First line\nSecond line";
    
    const result = managerWithoutSplitter.processResponse(
      contentWithNewlines,
      undefined,
      undefined,
      undefined // No API turns and no splitter
    );

    expect(result).toBe(false); // Should return false as no splitting capability
  });

  it('should respect normal probability when content has no newlines', () => {
    const contentWithoutNewlines = "This is a single line of text without any line breaks.";
    const apiTurns = ["This is a single line", "of text without any line breaks."];
    
    // With splitProbability = 0, this should return false
    const result = manager.processResponse(
      contentWithoutNewlines,
      undefined,
      undefined,
      apiTurns
    );

    expect(result).toBe(false); // Should return false due to low probability
  });

  it('should handle content with only newlines at the end', () => {
    const contentWithTrailingNewlines = "Some content\n\n";
    const apiTurns = ["Some content", ""];
    
    const result = manager.processResponse(
      contentWithTrailingNewlines,
      undefined,
      undefined,
      apiTurns
    );

    expect(result).toBe(true); // Should force splitting due to newlines
  });

  it('should handle mixed content with newlines and normal probability override', () => {
    // Test with higher probability to ensure newline override works regardless
    const highProbConfig = { ...config, splitProbability: 1.0 };
    const highProbManager = new ConversationalTurnsManager(
      highProbConfig, 
      mockCallback, 
      mockEventEmitter
    );

    const contentWithNewlines = "Line 1\nLine 2";
    const apiTurns = ["Line 1", "Line 2"];
    
    const result = highProbManager.processResponse(
      contentWithNewlines,
      undefined,
      undefined,
      apiTurns
    );

    expect(result).toBe(true); // Should split due to both newlines and high probability
  });
});