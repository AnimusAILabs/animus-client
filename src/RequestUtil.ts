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
    let attempts = 0;
    const maxAttempts = 2; // Initial attempt + 1 retry

    while (attempts < maxAttempts) {
      attempts++;
      let token: string;
      try {
        // Get token for the current attempt
        token = await this.authHandler.getToken();
      } catch (authError) {
        // If getting the token fails even on retry, re-throw
        if (authError instanceof AuthenticationError) throw authError;
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
          // Check if it's a 401 error and if we can retry
          if (response.status === 401 && attempts < maxAttempts) {
            
            this.authHandler.clearAllDetails(); // Clear stored details to force refresh on next getToken()
            continue; // Go to the next iteration of the loop to retry
          }

          // If not 401 or if it's the last attempt, handle as final error
          let errorData: any = null;
          let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
          try {
            errorData = await response.json();
            if (errorData && typeof errorData === 'object' && errorData.message) {
              errorMessage = `API Error (${response.status}): ${errorData.message}`;
            } else if (errorData && typeof errorData === 'object' && errorData.detail) {
               errorMessage = `API Error (${response.status}): ${errorData.detail}`;
            }
          } catch (_) { /* Ignore parsing error */ }
          throw new ApiError(errorMessage, response.status, errorData);
        }

        // --- Success ---
        if (stream) {
          return response;
        }
        if (response.status === 204) {
          return null as T;
        }
        return await response.json() as T;

      } catch (error) {
        // If it's an ApiError from the current attempt (e.g., 401 on last attempt, or other non-401 error)
        if (error instanceof ApiError) {
            // If it was a 401 on the final attempt, or another API error, throw it
             if (error.status === 401 && attempts >= maxAttempts) {
                 console.error(`RequestUtil: Failed with 401 even after retry.`);
             }
             throw error;
        }
        // Re-throw AuthenticationError if token fetching itself failed within the loop
        if (error instanceof AuthenticationError) {
            throw error;
        }
        // Wrap unknown errors (network issues, etc.)
        throw new Error(`Network or unexpected error during API request (Attempt ${attempts}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Should be unreachable if loop logic is correct, but satisfies TypeScript
    throw new Error("Request failed after maximum attempts.");
  }
}