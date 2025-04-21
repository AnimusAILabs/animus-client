import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Import necessary types from Media module
import {
  MediaModule,
  MediaCompletionRequest,
  MediaCompletionResponse,
  MediaAnalysisRequest,
  MediaAnalysisResultResponse,
  MediaAnalysisJobStartResponse,
  MediaAnalysisStatusResponse
} from '../src/Media';
import { RequestUtil } from '../src/RequestUtil';
import { AuthHandler } from '../src/AuthHandler';

// Mock dependencies
vi.mock('../src/RequestUtil');
vi.mock('../src/AuthHandler');

describe('MediaModule', () => {
  let requestUtilMock: RequestUtil;
  let mediaModule: MediaModule;

  beforeEach(() => {
    // Create instances of mocks for each test
    const authHandlerMock = new AuthHandler('http://dummy-url', 'sessionStorage');
    requestUtilMock = new RequestUtil('http://dummy-base', authHandlerMock);
    // Provide dummy vision options including the required model
    mediaModule = new MediaModule(requestUtilMock, { model: 'test-vision-model' });
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore mocks after each test
  });

  it('should instantiate correctly', () => {
    expect(mediaModule).toBeInstanceOf(MediaModule);
  });

  it('should have a completions method', () => {
    expect(mediaModule.completions).toBeInstanceOf(Function);
  });

  it('should have an analyze method', () => {
    expect(mediaModule.analyze).toBeInstanceOf(Function);
  });

  it('should have a getAnalysisStatus method', () => {
    expect(mediaModule.getAnalysisStatus).toBeInstanceOf(Function);
  });

  it('should store initial vision options', () => {
    // Access private config for testing
    expect((mediaModule as any).config?.model).toBe('test-vision-model');
  });

  it('should call requestUtil correctly for media completions', async () => {
    const requestMock = vi.spyOn(requestUtilMock, 'request');
    const mockResponse: MediaCompletionResponse = { id: 'mcr1', object: 'chat.completion', created: 1, model: 'test-vision-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Image description' }, finish_reason: 'stop' }] };
    requestMock.mockResolvedValue(mockResponse);

    const request: MediaCompletionRequest = {
      model: 'override-vision-model', // Test model override
      messages: [
        { role: 'user', content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
          ]
        }
      ],
      temperature: 0.2,
    };

    const result = await mediaModule.completions(request);

    expect(result).toEqual(mockResponse);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith(
      'POST',
      '/media/completions',
      expect.objectContaining({
        model: 'override-vision-model', // Should use the request model
        messages: request.messages, // Messages should be passed directly
        temperature: 0.2
      })
    );
    requestMock.mockRestore();
  });

  it('should call requestUtil correctly for image analysis (direct result)', async () => {
    const requestMock = vi.spyOn(requestUtilMock, 'request');
    const mockResponse: MediaAnalysisResultResponse = {
      metadata: { categories: ['outdoor', 'nature'], tags: ['tree', 'sky'] }
    };
    requestMock.mockResolvedValue(mockResponse);

    const request: MediaAnalysisRequest = {
      media_url: 'https://example.com/image.png',
      metadata: ['categories', 'tags'],
      model: 'test-vision-model' // Ensure model is provided if required by implementation
    };

    const result = await mediaModule.analyze(request);

    expect(result).toEqual(mockResponse);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith(
      'POST',
      '/media/categories',
      expect.objectContaining({
        media_url: request.media_url,
        metadata: request.metadata,
        model: request.model,
      })
    );
    requestMock.mockRestore();
  });

  it('should handle video analysis polling correctly', async () => {
    vi.useFakeTimers(); // Enable fake timers for this test

    const requestMock = vi.spyOn(requestUtilMock, 'request');
    const jobId = 'video-job-123';

    // Mock responses for polling sequence - use 'as any' to bypass intersection type issues for mocks
    const jobStartResponse: MediaAnalysisJobStartResponse = { job_id: jobId, status: 'PROCESSING' };
    const processingResponse = { job_id: jobId, status: 'PROCESSING', percent_complete: 50 } as any as MediaAnalysisStatusResponse;
    const completedResponse = {
      job_id: jobId,
      status: 'COMPLETED',
      percent_complete: 100,
      results: [{ timestamp: '00:00:10', categories: ['vehicle', 'car'] }]
    };

    // Setup mock sequence for requestUtil.request
    requestMock
      .mockResolvedValueOnce(jobStartResponse)    // 1. Initial POST -> job started
      .mockResolvedValueOnce(processingResponse)  // 2. First GET poll -> processing
      .mockResolvedValueOnce(processingResponse)  // 3. Second GET poll -> processing
      .mockResolvedValueOnce(completedResponse);  // 4. Third GET poll -> completed

    const request: MediaAnalysisRequest = {
      media_url: 'https://example.com/video.mp4',
      metadata: ['categories'],
      model: 'test-vision-model'
    };

    // Use Promise.all to run analyze and advance timers concurrently
    const analyzePromise = mediaModule.analyze(request);

    // Advance time past several polling intervals
    // Need to advance slightly more than interval * number of processing polls
    // Default interval is 5000ms. We expect 1 processing poll before completion.
    await vi.advanceTimersByTimeAsync(5000 * 3); // Advance 15 seconds

    const result = await analyzePromise; // Wait for analyze to complete

    // Assertions
    expect(result).toEqual(completedResponse);
    expect(requestMock).toHaveBeenCalledTimes(4); // 1 POST + 3 GETs

    // Check calls
    // Corrected: Remove the final 'undefined' argument check for the POST call
    // Also ensure the objectContaining checks the full payload if necessary, not just media_url
    expect(requestMock).toHaveBeenNthCalledWith(1, 'POST', '/media/categories', expect.objectContaining({
        media_url: request.media_url,
        metadata: request.metadata,
        model: request.model
    }));
    expect(requestMock).toHaveBeenNthCalledWith(2, 'GET', `/media/categories/${jobId}`);
    expect(requestMock).toHaveBeenNthCalledWith(3, 'GET', `/media/categories/${jobId}`);
    expect(requestMock).toHaveBeenNthCalledWith(4, 'GET', `/media/categories/${jobId}`);


    requestMock.mockRestore();
    vi.useRealTimers(); // Restore real timers
  });

  it('should call requestUtil correctly for getAnalysisStatus', async () => {
    const requestMock = vi.spyOn(requestUtilMock, 'request');
    const jobId = 'status-job-456';
    // Use 'as any' cast for the mock response due to intersection type issues
    const mockResponse = { job_id: jobId, status: 'COMPLETED', percent_complete: 100 } as any as MediaAnalysisStatusResponse;
    requestMock.mockResolvedValue(mockResponse);

    const result = await mediaModule.getAnalysisStatus(jobId);

    expect(result).toEqual(mockResponse);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith('GET', `/media/categories/${jobId}`);
    requestMock.mockRestore();
  });

});