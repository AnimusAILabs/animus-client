import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { RequestUtil, ApiError } from '../src/RequestUtil';
import { AuthHandler, AuthenticationError } from '../src/AuthHandler';

// Mock dependencies
vi.mock('../src/AuthHandler');
globalThis.fetch = vi.fn(); // Mock fetch globally

// Helper to mock fetch responses
const mockFetchResponse = (status: number, body: any, ok: boolean = true) => {
  (fetch as Mock).mockResolvedValue({
    ok: ok,
    status: status,
    statusText: `Status ${status}`,
    json: async () => body,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    // Mock ReadableStream for streaming tests if needed later
    body: null, // Placeholder for non-streaming
  });
};

// Helper to mock fetch errors (network error)
const mockFetchNetworkError = (message: string = 'Network error') => {
  (fetch as Mock).mockRejectedValue(new Error(message));
};

describe('RequestUtil', () => {
  const apiBaseUrl = 'https://api.test.com/v3';
  let authHandlerMock: AuthHandler;
  let requestUtil: RequestUtil;
  let getTokenMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup AuthHandler mock
    // We need to mock the *instance* methods, specifically getToken
    getTokenMock = vi.fn().mockResolvedValue('mock-auth-token');
    // Mock the constructor and the instance methods
    vi.mocked(AuthHandler).mockImplementation(() => ({
        getToken: getTokenMock,
        // Mock other methods if needed by RequestUtil, otherwise provide dummies
        clearToken: vi.fn(),
        loadTokenFromStorage: vi.fn(), // Add dummy implementations for any methods called internally if necessary
        fetchNewToken: vi.fn(),
        isTokenExpired: vi.fn(),
    } as unknown as AuthHandler)); // Use unknown cast carefully

    // Create a *mocked* instance
    authHandlerMock = new AuthHandler('dummy-url', 'sessionStorage'); // Args don't matter much due to mockImplementation

    requestUtil = new RequestUtil(apiBaseUrl, authHandlerMock);

    // Reset fetch to a default success state
    mockFetchResponse(200, { success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should make a GET request with correct headers', async () => {
    const responseData = { data: 'get result' };
    mockFetchResponse(200, responseData);

    const result = await requestUtil.request('GET', '/test-endpoint');

    expect(result).toEqual(responseData);
    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${apiBaseUrl}/test-endpoint`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer mock-auth-token',
        'Accept': 'application/json'
      }
    });
  });

  it('should make a POST request with body and correct headers', async () => {
    const requestBody = { param1: 'value1' };
    const responseData = { id: '123' };
    mockFetchResponse(201, responseData);

    const result = await requestUtil.request('POST', '/create-resource', requestBody);

    expect(result).toEqual(responseData);
    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${apiBaseUrl}/create-resource`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer mock-auth-token',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  });

  it('should handle API error response (non-2xx)', async () => {
    const errorBody = { code: 'INVALID_INPUT', message: 'Bad request data' };
    mockFetchResponse(400, errorBody, false);

    // First check it throws ApiError
    await expect(requestUtil.request('POST', '/fail-endpoint', {})).rejects.toThrow(ApiError);
    await expect(requestUtil.request('POST', '/fail-endpoint', {})).rejects.toThrow('API Error (400): Bad request data');

    // Keep the try/catch for detailed checking
    try {
        await requestUtil.request('POST', '/fail-endpoint', {});
    } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        const apiError = e as ApiError;
        expect(apiError.status).toBe(400);
        expect(apiError.errorData).toEqual(errorBody); // Check if error body is attached
    }

    // Each await expect counts as a call, plus the try/catch makes 3
    expect(getTokenMock).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

   it('should handle AuthenticationError from AuthHandler', async () => {
    // Create the error instance beforehand
    const authError = new AuthenticationError('Token fetch failed');
    getTokenMock.mockRejectedValue(authError); // Use the pre-created instance

    try {
      await requestUtil.request('GET', '/secure-endpoint');
      // If it doesn't throw, fail the test explicitly
      expect.fail('Expected requestUtil.request to throw AuthenticationError');
    } catch (e) {
      expect(e).toBeInstanceOf(AuthenticationError);
      // Check if the caught error is the exact instance we created
      expect(e).toBe(authError);
    }

    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled(); // Fetch should not be called if getToken fails
  });

  it('should handle network error during fetch', async () => {
    mockFetchNetworkError('Connection refused');

    await expect(requestUtil.request('GET', '/network-error-endpoint')).rejects.toThrow(Error);
    // Check the specific wrapped error message, including the attempt number
    await expect(requestUtil.request('GET', '/network-error-endpoint')).rejects.toThrow('Network or unexpected error during API request (Attempt 1): Connection refused');

    expect(getTokenMock).toHaveBeenCalledTimes(2); // Called for each attempt
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should handle streaming request and return raw Response', async () => {
    // Mock a Response object suitable for streaming
    const mockStreamResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: new ReadableStream(), // Provide a mock ReadableStream
      headers: new Headers({ 'Content-Type': 'text/event-stream' }),
      // Add other Response properties if needed by the consumer
    } as Response; // Cast to Response type

    (fetch as Mock).mockResolvedValue(mockStreamResponse);

    const result = await requestUtil.request('POST', '/stream-endpoint', { data: 'stream' }, true); // stream: true

    expect(result).toBe(mockStreamResponse); // Should return the raw Response object
    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${apiBaseUrl}/stream-endpoint`, expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Accept': 'text/event-stream', // Correct Accept header for streaming
        'Content-Type': 'application/json', // Body is still JSON
      }),
      body: JSON.stringify({ data: 'stream' }),
    }));
  });

});