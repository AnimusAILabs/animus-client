import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { AuthHandler, AuthenticationError } from '../src/AuthHandler';

// Mock fetch globally for this test file using globalThis
globalThis.fetch = vi.fn();

// Helper to mock fetch responses
const mockFetchResponse = (status: number, body: any, ok: boolean = true) => {
  (fetch as Mock).mockResolvedValue({
    ok: ok,
    status: status,
    statusText: `Status ${status}`,
    json: async () => body,
    text: async () => JSON.stringify(body), // Simple text representation
  });
};

// Helper to mock fetch errors (network error)
const mockFetchNetworkError = (message: string = 'Network error') => {
  (fetch as Mock).mockRejectedValue(new Error(message));
};

describe('AuthHandler', () => {
  const tokenProviderUrl = 'http://test-token-provider.com/token';
  const storageKey = 'animus_sdk_auth_token';
  const expiryKey = 'animus_sdk_auth_expiry';

  beforeEach(() => {
    // Clear mocks and storage before each test
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    // Reset fetch mock to a default state (optional, good practice)
    mockFetchResponse(200, { accessToken: 'default-token', expiresIn: 3600 });
  });

  afterEach(() => {
    // Ensure mocks are restored after each test
    vi.restoreAllMocks();
  });

  it('should instantiate with sessionStorage by default', () => {
    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');
    // Check internal state (use with caution)
    expect((authHandler as any).tokenStore.storage).toBe(sessionStorage);
  });

  it('should instantiate with localStorage', () => {
    const authHandler = new AuthHandler(tokenProviderUrl, 'localStorage');
    expect((authHandler as any).tokenStore.storage).toBe(localStorage);
  });

  it('should fetch a new token if none exists', async () => {
    const tokenData = { accessToken: 'new-token-123', expiresIn: 3600 };
    mockFetchResponse(200, tokenData);
    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    const token = await authHandler.getToken();

    expect(token).toBe('new-token-123');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(tokenProviderUrl, expect.objectContaining({ method: 'POST' }));
    expect(sessionStorage.getItem(storageKey)).toBe('new-token-123');
    expect(sessionStorage.getItem(expiryKey)).not.toBeNull();
  });

  it('should return stored token if valid', async () => {
    const storedToken = 'valid-stored-token';
    const expiryTime = Date.now() + 600 * 1000; // Expires in 10 minutes
    sessionStorage.setItem(storageKey, storedToken);
    sessionStorage.setItem(expiryKey, expiryTime.toString());

    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');
    const token = await authHandler.getToken();

    expect(token).toBe(storedToken);
    expect(fetch).not.toHaveBeenCalled(); // Should not fetch new token
  });

  it('should fetch a new token if stored token is expired', async () => {
    const storedToken = 'expired-token';
    const expiryTime = Date.now() - 1000; // Expired 1 second ago
    sessionStorage.setItem(storageKey, storedToken);
    sessionStorage.setItem(expiryKey, expiryTime.toString());

    const newTokenData = { accessToken: 'fresh-token-456', expiresIn: 3600 };
    mockFetchResponse(200, newTokenData);

    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');
    const token = await authHandler.getToken();

    expect(token).toBe('fresh-token-456');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(storageKey)).toBe('fresh-token-456');
  });

  // Renamed and corrected test logic
  it('should fetch a new token if stored token expiry time (incl. buffer) has passed', async () => {
    const storedToken = 'past-refresh-point-token';
    // Simulate an expiry time (incl. buffer) that was 1 second ago
    const storedExpiryTime = Date.now() - 1000;
    sessionStorage.setItem(storageKey, storedToken);
    sessionStorage.setItem(expiryKey, storedExpiryTime.toString());

    const newTokenData = { accessToken: 'refreshed-token-789', expiresIn: 3600 };
    mockFetchResponse(200, newTokenData);

    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');
    // loadTokenFromStorage sets internal tokenExpiryTime to storedExpiryTime (past)

    const token = await authHandler.getToken();
    // getToken calls isTokenExpired() -> true, so fetchNewToken is called

    expect(token).toBe('refreshed-token-789'); // Check if the new token is returned
    expect(fetch).toHaveBeenCalledTimes(1); // Check if fetch was called

    // Check if the new token and expiry are stored
    expect(sessionStorage.getItem(storageKey)).toBe('refreshed-token-789');
    const newExpiryTimeStr = sessionStorage.getItem(expiryKey);
    expect(newExpiryTimeStr).not.toBeNull();
    // Optional: Check if the new expiry time is roughly correct
    const expectedNewExpiry = Date.now() + (newTokenData.expiresIn * 1000) - (60 * 1000); // Assuming default 60s buffer
    expect(parseInt(newExpiryTimeStr!, 10)).toBeGreaterThanOrEqual(expectedNewExpiry - 5000); // Allow 5s tolerance
    expect(parseInt(newExpiryTimeStr!, 10)).toBeLessThanOrEqual(expectedNewExpiry + 5000);
  });


  it('should handle token fetch failure (non-ok response)', async () => {
    mockFetchResponse(401, { error: 'Unauthorized' }, false);
    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    await expect(authHandler.getToken()).rejects.toThrow(AuthenticationError);
    await expect(authHandler.getToken()).rejects.toThrow(/Failed to fetch token from provider: 401 Status 401/);
    expect(sessionStorage.getItem(storageKey)).toBeNull(); // Should clear token on failure
  });

   it('should handle token fetch failure (network error)', async () => {
    mockFetchNetworkError('Failed to connect');
    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    await expect(authHandler.getToken()).rejects.toThrow(AuthenticationError);
    await expect(authHandler.getToken()).rejects.toThrow(/Network or other error fetching token: Failed to connect/);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('should handle invalid token response (missing accessToken)', async () => {
    mockFetchResponse(200, { wrongProperty: 'no-token' });
    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    await expect(authHandler.getToken()).rejects.toThrow(AuthenticationError);
    await expect(authHandler.getToken()).rejects.toThrow(/Invalid token response from provider: missing accessToken/);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('should clear token from storage', async () => {
     // Define the keys used by the refactored AuthHandler
     const animusTokenKey = 'animus_sdk_auth_token';
     const livekitTokenKey = 'animus_sdk_lk_token';
     const livekitUrlKey = 'animus_sdk_lk_url';
     const animusExpiryKey = 'animus_sdk_auth_expiry';
     const livekitExpiryKey = 'animus_sdk_lk_expiry';

     // Set dummy values for all keys
     sessionStorage.setItem(animusTokenKey, 'dummy-animus-token');
     sessionStorage.setItem(livekitTokenKey, 'dummy-lk-token');
     sessionStorage.setItem(livekitUrlKey, 'dummy-lk-url');
     sessionStorage.setItem(animusExpiryKey, (Date.now() + 600000).toString());
     sessionStorage.setItem(livekitExpiryKey, (Date.now() + 600000).toString());

     const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');
     authHandler.clearAllDetails(); // Use the renamed method

     // Expect all keys to be removed
     expect(sessionStorage.getItem(animusTokenKey)).toBeNull();
     expect(sessionStorage.getItem(livekitTokenKey)).toBeNull();
     expect(sessionStorage.getItem(livekitUrlKey)).toBeNull();
     expect(sessionStorage.getItem(animusExpiryKey)).toBeNull();
     expect(sessionStorage.getItem(livekitExpiryKey)).toBeNull();
     // Also check internal state if needed (though testing public behavior is preferred)
     expect((authHandler as any).currentToken).toBeNull();
     expect((authHandler as any).tokenExpiryTime).toBeNull();
  });

  it('should load token from storage on instantiation', () => {
    const storedToken = 'pre-existing-token';
    const expiryTime = Date.now() + 600 * 1000;
    sessionStorage.setItem(storageKey, storedToken);
    sessionStorage.setItem(expiryKey, expiryTime.toString());

    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Check internal state after instantiation
    expect((authHandler as any).currentToken).toBe(storedToken);
    expect((authHandler as any).tokenExpiryTime).toBe(expiryTime);
  });

});