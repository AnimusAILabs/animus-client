import { AuthHandler, AuthenticationError } from './AuthHandler';

/**
 * Custom error class for API errors.
 */
export class ApiError extends Error {
  public status: number;
  public errorData?: any; // To hold potential error details from the API response body

  constructor(message: string, status: number, errorData?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errorData = errorData;
  }
}

/**
 * Utility class for making authenticated requests to the Animus API.
 */
export class RequestUtil {
  private apiBaseUrl: string;
  private authHandler: AuthHandler;

  constructor(apiBaseUrl: string, authHandler: AuthHandler) {
    // Ensure base URL doesn't end with a slash
    this.apiBaseUrl = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
    this.authHandler = authHandler;
  }

  /**
   * Makes an authenticated request to the Animus API.
   *
   * @param method - HTTP method (GET, POST, etc.).
   * @param path - API endpoint path (e.g., '/chat/completions').
   * @param body - Optional request body for POST/PUT requests.
   * @param stream - Optional flag to indicate if the response should be treated as a stream.
   * @returns The parsed JSON response or the raw Response object if streaming.
   * @throws {ApiError} If the API returns an error status.
   * @throws {AuthenticationError} If token fetching fails.
   * @throws {Error} For network or other unexpected errors.
   */
  // Overload for streaming requests
  public async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: Record<string, any> | null | undefined,
    stream: true
  ): Promise<Response>;
  // Overload for non-streaming requests (default)
  public async request<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, any> | null,
    stream?: false | undefined // Make stream optional or false
  ): Promise<T>;
  // Implementation signature
  public async request<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, any> | null,
    stream: boolean = false // Keep boolean for implementation logic
  ): Promise<T | Response> { // Implementation return type covers both overloads
    let token: string;
    try {
      token = await this.authHandler.getToken();
    } catch (authError) {
      // Re-throw AuthenticationError directly
      if (authError instanceof AuthenticationError) throw authError;
      // Wrap other errors
      throw new AuthenticationError(`Failed to get authentication token: ${authError instanceof Error ? authError.message : String(authError)}`);
    }

    const url = `${this.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: HeadersInit = {
      'Authorization': `Bearer ${token}`,
      'Accept': stream ? 'text/event-stream' : 'application/json',
    };

    const options: RequestInit = {
      method: method,
      headers: headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        let errorData: any = null;
        let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
        try {
          // Try to parse error details from the response body
          errorData = await response.json();
          // If errorData has a specific message field, use it
          if (errorData && typeof errorData === 'object' && errorData.message) {
            errorMessage = `API Error (${response.status}): ${errorData.message}`;
          } else if (errorData && typeof errorData === 'object' && errorData.detail) {
             errorMessage = `API Error (${response.status}): ${errorData.detail}`;
          }
        } catch (_) {
          // If parsing fails, use the status text
        }
        throw new ApiError(errorMessage, response.status, errorData);
      }

      // For streaming requests, return the raw Response object
      if (stream) {
        return response;
      }

      // For non-streaming, parse and return JSON
      // Handle cases where the response might be empty (e.g., 204 No Content)
      if (response.status === 204) {
        return null as T; // Or return undefined, depending on desired behavior
      }
      return await response.json() as T;

    } catch (error) {
      // Re-throw known errors
      if (error instanceof ApiError || error instanceof AuthenticationError) {
        throw error;
      }
      // Wrap unknown errors
      throw new Error(`Network or unexpected error during API request: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}