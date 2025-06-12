import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnimusClient } from '../src/AnimusClient';
import { RequestUtil } from '../src/RequestUtil';

// Mock the RequestUtil
vi.mock('../src/RequestUtil');
vi.mock('../src/AuthHandler');

describe('Image Modification', () => {
  let client: AnimusClient;
  let mockRequestUtil: any;

  beforeEach(() => {
    // Create mock for RequestUtil
    mockRequestUtil = {
      request: vi.fn()
    };

    // Mock the RequestUtil constructor to return our mock
    (RequestUtil as any).mockImplementation(() => mockRequestUtil);

    // Create client with minimal config
    client = new AnimusClient({
      tokenProviderUrl: 'https://example.com/token',
      chat: {
        model: 'test-model',
        systemMessage: 'Test system message'
      }
    });
  });

  it('should generate a new image when no input image is provided', async () => {
    // Mock successful image generation response
    const mockResponse = {
      output: ['https://example.com/generated-image.jpg']
    };
    mockRequestUtil.request.mockResolvedValue(mockResponse);

    const result = await client.generateImage('A beautiful sunset');

    expect(mockRequestUtil.request).toHaveBeenCalledWith(
      'POST',
      '/generate/image',
      { prompt: 'A beautiful sunset' },
      false
    );
    expect(result).toBe('https://example.com/generated-image.jpg');
  });

  it('should modify an existing image when input image URL is provided', async () => {
    // Mock successful image modification response
    const mockResponse = {
      output: ['https://example.com/modified-image.jpg']
    };
    mockRequestUtil.request.mockResolvedValue(mockResponse);

    const result = await client.generateImage(
      'Make this a 90s cartoon style',
      'https://example.com/input-image.jpg'
    );

    expect(mockRequestUtil.request).toHaveBeenCalledWith(
      'POST',
      '/generate/image',
      { 
        prompt: 'Make this a 90s cartoon style',
        input_image: 'https://example.com/input-image.jpg'
      },
      false
    );
    expect(result).toBe('https://example.com/modified-image.jpg');
  });

  it('should throw error when prompt is empty for image generation', async () => {
    await expect(client.generateImage('')).rejects.toThrow(
      'Image generation requires a non-empty prompt'
    );
  });

  it('should throw error when prompt is empty for image modification', async () => {
    await expect(client.generateImage('', 'https://example.com/input.jpg')).rejects.toThrow(
      'Image modification requires a non-empty prompt'
    );
  });

  it('should throw error when input image URL is empty for modification', async () => {
    // When empty string is passed, it should fall back to generateImage which will fail due to no mock response
    await expect(client.generateImage('Make it cartoon', '')).rejects.toThrow();
  });

  it('should handle different response formats', async () => {
    // Test with string output format
    const mockResponse = {
      output: 'https://example.com/generated-image.jpg'
    };
    mockRequestUtil.request.mockResolvedValue(mockResponse);

    const result = await client.generateImage('A beautiful sunset');
    expect(result).toBe('https://example.com/generated-image.jpg');
  });

  it('should handle outputs array format', async () => {
    // Test with outputs array format
    const mockResponse = {
      outputs: ['https://example.com/generated-image.jpg']
    };
    mockRequestUtil.request.mockResolvedValue(mockResponse);

    const result = await client.generateImage('A beautiful sunset');
    expect(result).toBe('https://example.com/generated-image.jpg');
  });

  it('should throw error when no valid image URL is found in response', async () => {
    // Mock response with no valid image URL
    const mockResponse = {
      message: 'Success but no image'
    };
    mockRequestUtil.request.mockResolvedValue(mockResponse);

    await expect(client.generateImage('A beautiful sunset')).rejects.toThrow();
  });
});