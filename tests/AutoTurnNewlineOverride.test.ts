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
    
    // With newlines and API turns, it should always force splitting
    const result = manager.processResponse(
      contentWithNewlines,
      undefined,
      undefined,
      apiTurns
    );

    expect(result).toBe(true); // Should return true indicating splitting was applied
  });

  it('should force splitting when content contains newlines and autoTurn is enabled', () => {
    const contentWithNewlines = "First sentence.\nSecond sentence.\nThird sentence.";
    
    // Any API turns provided (indicating autoTurn=true) with newlines - should trigger splitting
    const result = manager.processResponse(
      contentWithNewlines,
      undefined,
      undefined,
      [contentWithNewlines] // API turns provided (autoTurn=true)
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

  it('should always use API turns when content has no newlines', () => {
    const contentWithoutNewlines = "This is a single line of text without any line breaks.";
    const apiTurns = ["This is a single line", "of text without any line breaks."];
    
    // When API provides multiple turns but no newlines, should always use them
    const result = manager.processResponse(
      contentWithoutNewlines,
      undefined,
      undefined,
      apiTurns
    );

    expect(result).toBe(true); // Should return true - always use API turns when available
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

  it('should handle mixed content with newlines', () => {
    // Test with the same config to ensure newline splitting works
    const testManager = new ConversationalTurnsManager(
      config,
      mockCallback,
      mockEventEmitter
    );

    const contentWithNewlines = "Line 1\nLine 2";
    const apiTurns = ["Line 1", "Line 2"];
    
    const result = testManager.processResponse(
      contentWithNewlines,
      undefined,
      undefined,
      apiTurns
    );

    expect(result).toBe(true); // Should split due to newlines
  });

  it('should always split when autoTurn=true and content has newlines', () => {
    // Test the specific scenario: autoTurn=true + newlines should always split
    const contentWithNewlines = "First part of message\nSecond part of message\nThird part";
    
    // Provide empty API turns array to indicate autoTurn=true, but no pre-split turns
    // This forces the system to rely on client-side newline splitting
    const result = manager.processResponse(
      contentWithNewlines,
      undefined,
      undefined,
      [] // Empty array indicates autoTurn=true but no API-provided turns
    );

    // Should return true because newlines always trigger splitting
    expect(result).toBe(true);
  });
});