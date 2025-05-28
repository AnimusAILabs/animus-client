import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatModule } from '../src/Chat';
import { RequestUtil } from '../src/RequestUtil';

describe('Image Generation Queue Integration', () => {
  let chatModule: ChatModule;
  let mockRequestUtil: RequestUtil;
  let mockGenerateImage: ReturnType<typeof vi.fn>;
  let mockEventEmitter: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock RequestUtil
    mockRequestUtil = {
      request: vi.fn()
    } as any;

    // Mock generateImage function that emits events like the real ImageGenerator
    mockGenerateImage = vi.fn().mockImplementation(async (prompt: string) => {
      // Emit imageGenerationStart event
      mockEventEmitter('imageGenerationStart', { prompt });
      
      // Simulate async image generation
      const imageUrl = 'https://example.com/generated-image.jpg';
      
      // Emit imageGenerationComplete event
      mockEventEmitter('imageGenerationComplete', { prompt, imageUrl });
      
      return imageUrl;
    });

    // Mock event emitter
    mockEventEmitter = vi.fn();

    // Create ChatModule with conversational turns enabled
    chatModule = new ChatModule(
      mockRequestUtil,
      {
        model: 'test-chat-model',
        systemMessage: 'Test system message',
        autoTurn: {
          enabled: true,
          splitProbability: 1.0, // Always split for testing
          shortSentenceThreshold: 30,
          baseTypingSpeed: 45,
          speedVariation: 0.2,
          minDelay: 100, // Short delays for testing
          maxDelay: 200
        }
      },
      mockGenerateImage,
      mockEventEmitter
    );
    
    // Verify the mock is properly set up
    expect(typeof mockGenerateImage).toBe('function');
  });

  it('should queue image generation after conversational turns', async () => {
    // Mock API response with turns and image prompt
    const mockResponse = {
      choices: [{
        message: {
          content: 'Here is your response',
          turns: ['Turn 1', 'Turn 2'],
          image_prompt: 'A beautiful sunset',
          next: false
        }
      }]
    };

    mockRequestUtil.request = vi.fn().mockResolvedValue(mockResponse);

    // Send a message
    const response = await chatModule.send('Generate an image for me');

    // Verify the API was called
    expect(mockRequestUtil.request).toHaveBeenCalled();

    // Wait longer for conversational turns and image generation to process
    // The queue processes: text turn 1 (0ms) -> text turn 2 (200ms) -> image (200ms)
    // So we need to wait at least 400ms + processing time
    await new Promise(resolve => setTimeout(resolve, 600));

    // Verify that image generation events were emitted (more reliable than mock calls)
    expect(mockEventEmitter).toHaveBeenCalledWith('imageGenerationStart', {
      prompt: 'A beautiful sunset'
    });

    expect(mockEventEmitter).toHaveBeenCalledWith('imageGenerationComplete', {
      prompt: 'A beautiful sunset',
      imageUrl: 'https://example.com/generated-image.jpg'
    });

    // Verify that generateImage was called (from the queue)
    expect(mockGenerateImage).toHaveBeenCalledWith('A beautiful sunset');
  });

  it('should generate image immediately when no turns are processed', async () => {
    // Create ChatModule without conversational turns
    const chatModuleNoTurns = new ChatModule(
      mockRequestUtil,
      {
        model: 'test-chat-model',
        systemMessage: 'Test system message'
        // No autoTurn config
      },
      mockGenerateImage,
      mockEventEmitter
    );

    // Mock API response with image prompt but no turns
    const mockResponse = {
      choices: [{
        message: {
          content: 'Here is your response',
          image_prompt: 'A beautiful sunset',
          next: false
        }
      }]
    };

    mockRequestUtil.request = vi.fn().mockResolvedValue(mockResponse);

    // Send a message with non-streaming request
    await chatModuleNoTurns.send('Generate an image for me', { stream: false });

    // Verify that generateImage was called immediately
    expect(mockGenerateImage).toHaveBeenCalledWith('A beautiful sunset');
  });

  it('should cancel image generation when new message is sent during turns', async () => {
    // Mock API response with turns and image prompt
    const mockResponse = {
      choices: [{
        message: {
          content: 'Here is your response',
          turns: ['Turn 1', 'Turn 2'],
          image_prompt: 'A beautiful sunset',
          next: false
        }
      }]
    };

    mockRequestUtil.request = vi.fn().mockResolvedValue(mockResponse);

    // Send first message
    chatModule.send('Generate an image for me');

    // Wait a bit for turns to start
    await new Promise(resolve => setTimeout(resolve, 50));

    // Send another message (should cancel pending turns and image generation)
    await chatModule.send('Cancel that and do something else');

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify that generateImage was not called for the first request
    // (it should have been canceled)
    expect(mockGenerateImage).toHaveBeenCalledTimes(0);
  });

  it('should not emit duplicate imageGenerationStart events', async () => {
    // Create ChatModule without conversational turns for immediate image generation
    const chatModuleNoTurns = new ChatModule(
      mockRequestUtil,
      {
        model: 'test-chat-model',
        systemMessage: 'Test system message'
        // No autoTurn config
      },
      mockGenerateImage,
      mockEventEmitter
    );

    // Mock API response with image prompt
    const mockResponse = {
      choices: [{
        message: {
          content: 'Here is your response',
          image_prompt: 'A beautiful sunset',
          next: false
        }
      }]
    };

    mockRequestUtil.request = vi.fn().mockResolvedValue(mockResponse);

    // Send a message with non-streaming request
    await chatModuleNoTurns.send('Generate an image for me', { stream: false });

    // Verify that imageGenerationStart was called exactly once
    const imageStartCalls = mockEventEmitter.mock.calls.filter(
      call => call[0] === 'imageGenerationStart'
    );
    
    expect(imageStartCalls).toHaveLength(1);
    expect(imageStartCalls[0]).toEqual(['imageGenerationStart', {
      prompt: 'A beautiful sunset'
    }]);

    // Verify that imageGenerationComplete was also called exactly once
    const imageCompleteCalls = mockEventEmitter.mock.calls.filter(
      call => call[0] === 'imageGenerationComplete'
    );
    
    expect(imageCompleteCalls).toHaveLength(1);
    expect(imageCompleteCalls[0]).toEqual(['imageGenerationComplete', {
      prompt: 'A beautiful sunset',
      imageUrl: 'https://example.com/generated-image.jpg'
    }]);
  });
});