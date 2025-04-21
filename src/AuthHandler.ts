/**
 * Simple abstraction for browser storage (localStorage or sessionStorage).
 */
class TokenStore {
  private storage: Storage;

  constructor(storageType: 'localStorage' | 'sessionStorage' = 'sessionStorage') {
    this.storage = storageType === 'localStorage' ? localStorage : sessionStorage;
  }

  setItem(key: string, value: string): void {
    this.storage.setItem(key, value);
  }

  getItem(key: string): string | null {
    return this.storage.getItem(key);
  }

  removeItem(key: string): void {
    this.storage.removeItem(key);
  }
}

/**
 * Represents the structure of the token response expected from the tokenProviderUrl.
 * Adjust this interface based on the actual response structure of the proxy.
 */
interface TokenResponse {
  accessToken: string;
  /** Expiration time in seconds (e.g., 3600 for 1 hour) or a timestamp. */
  expiresIn?: number; // Or expiresAt?: number (timestamp)
  // Add other relevant fields if needed
}

/**
 * Custom error class for authentication failures.
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
    // Explicitly set the message property, just in case super() doesn't work as expected in this env
    this.message = message;
  }
}

/**
 * Handles fetching and storing authentication tokens from the provider URL.
 */
export class AuthHandler {
  private tokenProviderUrl: string;
  private tokenStore: TokenStore;
  private currentToken: string | null = null;
  private tokenExpiryTime: number | null = null; // Store expiry time (timestamp in ms)
  private readonly storageKey = 'animus_sdk_auth_token';
  private readonly expiryKey = 'animus_sdk_auth_expiry';
  private readonly bufferTime = 60 * 1000; // Fetch new token 60 seconds before expiry

  constructor(tokenProviderUrl: string, storageType: 'localStorage' | 'sessionStorage') {
    this.tokenProviderUrl = tokenProviderUrl;
    this.tokenStore = new TokenStore(storageType);
    this.loadTokenFromStorage();
  }

  /**
   * Loads token and expiry from storage if available.
   */
  private loadTokenFromStorage(): void {
    this.currentToken = this.tokenStore.getItem(this.storageKey);
    const expiry = this.tokenStore.getItem(this.expiryKey);
    this.tokenExpiryTime = expiry ? parseInt(expiry, 10) : null;
  }

  /**
   * Fetches a new token from the configured provider URL.
   * @returns The fetched access token.
   * @throws {AuthenticationError} If fetching fails.
   */
  private async fetchNewToken(): Promise<string> {
    try {
      // Use POST as it's more standard for token endpoints, even if no body is sent by default
      const response = await fetch(this.tokenProviderUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          // 'Content-Type': 'application/json', // Add if sending a body
          // Add any other headers required by the token proxy
        },
        // body: JSON.stringify({}), // Send empty body or specific data if required by proxy
      });

      if (!response.ok) {
        let errorBody = 'Failed to fetch token';
        try {
          errorBody = await response.text(); // Try to get more details
        } catch (_) { /* Ignore parsing error */ }
        throw new AuthenticationError(`Failed to fetch token from provider: ${response.status} ${response.statusText}. ${errorBody}`);
      }

      const tokenData = await response.json() as TokenResponse;

      if (!tokenData.accessToken) {
        throw new AuthenticationError('Invalid token response from provider: missing accessToken');
      }

      this.currentToken = tokenData.accessToken;
      this.tokenStore.setItem(this.storageKey, this.currentToken);

      // Handle expiry
      if (tokenData.expiresIn && tokenData.expiresIn > 0) {
        // Calculate expiry timestamp (now + expiresIn seconds - buffer)
        this.tokenExpiryTime = Date.now() + (tokenData.expiresIn * 1000) - this.bufferTime;
        this.tokenStore.setItem(this.expiryKey, this.tokenExpiryTime.toString());
      } else {
        // If no expiry provided, clear stored expiry
        this.tokenExpiryTime = null;
        this.tokenStore.removeItem(this.expiryKey);
        console.warn('Token provider did not return expiresIn. Token expiry cannot be managed automatically.');
      }

      return this.currentToken;

    } catch (error) {
      this.clearToken(); // Clear potentially invalid token on fetch failure
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError(`Network or other error fetching token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Checks if the current token is expired or nearing expiry.
   */
  private isTokenExpired(): boolean {
    if (!this.currentToken) return true; // No token means expired
    if (!this.tokenExpiryTime) return false; // No expiry info, assume valid (with warning)
    return Date.now() >= this.tokenExpiryTime;
  }

  /**
   * Retrieves the current valid access token, fetching a new one if necessary.
   * @returns A valid access token.
   * @throws {AuthenticationError} If a valid token cannot be obtained.
   */
  public async getToken(): Promise<string> {
    if (!this.currentToken || this.isTokenExpired()) {
      console.log('Token missing or expired, fetching new token...');
      return await this.fetchNewToken();
    }
    return this.currentToken;
  }

  /**
   * Clears the stored token and expiry information.
   */
  public clearToken(): void {
    this.currentToken = null;
    this.tokenExpiryTime = null;
    this.tokenStore.removeItem(this.storageKey);
    this.tokenStore.removeItem(this.expiryKey);
  }
}