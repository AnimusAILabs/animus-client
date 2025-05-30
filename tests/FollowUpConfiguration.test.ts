import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatModule } from '../src/Chat';
import { RequestUtil } from '../src/RequestUtil';
import { ChatHistory } from '../src/chat/ChatHistory';
import type { AnimusChatOptions } from '../src/client/types';

describe('Follow-up Configuration', () => {
  let chatModule: ChatModule;
  let requestUtilMock: any;
  let chatOptions: AnimusChatOptions;

  beforeEach(() => {
    // Mock RequestUtil
    requestUtilMock = {
      request: vi.fn()
    };

    chatOptions = {
      model: 'test-model',
      systemMessage: 'You are a helpful assistant.',
      historySize: 10,
      autoTurn: {
        enabled: true,
        followUpDelay: 500, // Custom 500ms delay
        maxSequentialFollowUps: 1 // Custom max of 1 follow-up
      }
    };

    chatModule = new ChatModule(
      requestUtilMock as RequestUtil,
      chatOptions,
      undefined, // eventEmitter
      undefined  // generateImage
    );
  });

  it('should use custom follow-up delay from configuration', () => {
    // Access the private followUpHandler to check the configuration
    const followUpHandler = (chatModule as any).followUpHandler;
    
    // Check that the custom delay is being used
    expect(followUpHandler.followUpDelay).toBe(500);
  });

  it('should use custom max sequential follow-ups from configuration', () => {
    // Access the private followUpHandler to check the configuration
    const followUpHandler = (chatModule as any).followUpHandler;
    
    // Check that the custom max sequential follow-ups is being used
    expect(followUpHandler.maxSequentialFollowUps).toBe(1);
  });

  it('should use default values when autoTurn is boolean true', () => {
    const defaultChatOptions: AnimusChatOptions = {
      model: 'test-model',
      systemMessage: 'You are a helpful assistant.',
      autoTurn: true // Boolean instead of object
    };

    const defaultChatModule = new ChatModule(
      requestUtilMock as RequestUtil,
      defaultChatOptions,
      undefined,
      undefined
    );

    const followUpHandler = (defaultChatModule as any).followUpHandler;
    
    // Should use default values
    expect(followUpHandler.followUpDelay).toBe(2000); // Default 2 seconds
    expect(followUpHandler.maxSequentialFollowUps).toBe(2); // Default 2
  });

  it('should use default values when autoTurn config is missing follow-up settings', () => {
    const partialChatOptions: AnimusChatOptions = {
      model: 'test-model',
      systemMessage: 'You are a helpful assistant.',
      autoTurn: {
        enabled: true
        // followUpDelay and maxSequentialFollowUps not specified
      }
    };

    const partialChatModule = new ChatModule(
      requestUtilMock as RequestUtil,
      partialChatOptions,
      undefined,
      undefined
    );

    const followUpHandler = (partialChatModule as any).followUpHandler;
    
    // Should use default values
    expect(followUpHandler.followUpDelay).toBe(2000); // Default 2 seconds
    expect(followUpHandler.maxSequentialFollowUps).toBe(2); // Default 2
  });
});