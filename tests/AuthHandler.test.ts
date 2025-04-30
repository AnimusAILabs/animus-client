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

// --- Helper Functions for Mock Tokens/Responses ---
// (These would ideally be in a separate test utility file)

// Structure expected by AuthHandler
interface TokenResponse {
  animus: { token: string; };
  livekit: {
    observer: { url: string; token: string; };
    voice: { url: string; token: string; };
  };
}

// Creates a valid mock TokenResponse object
const createMockTokenResponse = (
    animusTokenPayload = { exp: Math.floor(Date.now() / 1000) + 3600 }, // Default 1hr expiry
    observerTokenPayload = { exp: Math.floor(Date.now() / 1000) + 3600 },
    voiceTokenPayload = { exp: Math.floor(Date.now() / 1000) + 3600 },
    observerUrl = 'wss://observer.example.com',
    voiceUrl = 'wss://voice.example.com'
): TokenResponse => {
    // Helper to create a dummy JWT string (header.payload.signature)
    const createDummyJwt = (payload: object): string => {
        const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
        const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '');
        const signature = btoa('dummySignature').replace(/=/g, '');
        return `${header}.${encodedPayload}.${signature}`;
    };

    return {
        animus: { token: createDummyJwt(animusTokenPayload) },
        livekit: {
            observer: { token: createDummyJwt(observerTokenPayload), url: observerUrl },
            voice: { token: createDummyJwt(voiceTokenPayload), url: voiceUrl },
        },
    };
};
// --- End Helper Functions ---


describe('AuthHandler', () => {
  const tokenProviderUrl = 'http://test-token-provider.com/token';
  // New storage keys (match AuthHandler.ts)
  const animusTokenKey = 'animus_sdk_auth_token';
  const animusExpiryKey = 'animus_sdk_auth_expiry';
  const livekitObserverTokenKey = 'animus_sdk_lk_obs_token';
  const livekitObserverUrlKey = 'animus_sdk_lk_obs_url';
  const livekitObserverExpiryKey = 'animus_sdk_lk_obs_expiry';
  const livekitVoiceTokenKey = 'animus_sdk_lk_voice_token';
  const livekitVoiceUrlKey = 'animus_sdk_lk_voice_url';
  const livekitVoiceExpiryKey = 'animus_sdk_lk_voice_expiry';


  beforeEach(() => {
    // Clear mocks and storage before each test
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    // Reset fetch mock to a default valid response structure
    mockFetchResponse(200, createMockTokenResponse());
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

  it('should fetch new details if none exist', async () => {
    // Create a mock response with specific tokens we can check
    const mockResponse = createMockTokenResponse(
        { exp: Math.floor(Date.now() / 1000) + 1800 }, // Animus token with 30min expiry
        { exp: Math.floor(Date.now() / 1000) + 1800 }, // Observer token
        { exp: Math.floor(Date.now() / 1000) + 1800 }  // Voice token
    );
    mockFetchResponse(200, mockResponse);
    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Call getToken (which triggers fetch)
    const animusToken = await authHandler.getToken();
    // Call getLiveKitDetails (should use cached data from the same fetch)
    const observerDetails = await authHandler.getLiveKitDetails('observer');
    const voiceDetails = await authHandler.getLiveKitDetails('voice');

    // Check returned values
    expect(animusToken).toBe(mockResponse.animus.token);
    expect(observerDetails.token).toBe(mockResponse.livekit.observer.token);
    expect(observerDetails.url).toBe(mockResponse.livekit.observer.url);
    expect(voiceDetails.token).toBe(mockResponse.livekit.voice.token);
    expect(voiceDetails.url).toBe(mockResponse.livekit.voice.url);

    // Check fetch call
    expect(fetch).toHaveBeenCalledTimes(1); // Only one fetch for all details
    expect(fetch).toHaveBeenCalledWith(tokenProviderUrl, expect.objectContaining({ method: 'POST' }));

    // Check storage
    expect(sessionStorage.getItem(animusTokenKey)).toBe(mockResponse.animus.token);
    expect(sessionStorage.getItem(animusExpiryKey)).not.toBeNull();
    expect(sessionStorage.getItem(livekitObserverTokenKey)).toBe(mockResponse.livekit.observer.token);
    expect(sessionStorage.getItem(livekitObserverUrlKey)).toBe(mockResponse.livekit.observer.url);
    expect(sessionStorage.getItem(livekitObserverExpiryKey)).not.toBeNull();
    expect(sessionStorage.getItem(livekitVoiceTokenKey)).toBe(mockResponse.livekit.voice.token);
    expect(sessionStorage.getItem(livekitVoiceUrlKey)).toBe(mockResponse.livekit.voice.url);
    expect(sessionStorage.getItem(livekitVoiceExpiryKey)).not.toBeNull();
  });

  it('should return stored details if valid', async () => {
    // Store valid details
    const expiryTime = Date.now() + 600 * 1000; // Expires in 10 minutes
    const storedAnimusToken = 'valid-animus-token';
    const storedObserverToken = 'valid-observer-token';
    const storedObserverUrl = 'wss://valid-observer.com';
    const storedVoiceToken = 'valid-voice-token';
    const storedVoiceUrl = 'wss://valid-voice.com';

    sessionStorage.setItem(animusTokenKey, storedAnimusToken);
    sessionStorage.setItem(animusExpiryKey, expiryTime.toString());
    sessionStorage.setItem(livekitObserverTokenKey, storedObserverToken);
    sessionStorage.setItem(livekitObserverUrlKey, storedObserverUrl);
    sessionStorage.setItem(livekitObserverExpiryKey, expiryTime.toString());
    sessionStorage.setItem(livekitVoiceTokenKey, storedVoiceToken);
    sessionStorage.setItem(livekitVoiceUrlKey, storedVoiceUrl);
    sessionStorage.setItem(livekitVoiceExpiryKey, expiryTime.toString());

    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage'); // Instantiating loads from storage

    // Get details
    const animusToken = await authHandler.getToken();
    const observerDetails = await authHandler.getLiveKitDetails('observer');
    const voiceDetails = await authHandler.getLiveKitDetails('voice');

    // Check returned values match stored values
    expect(animusToken).toBe(storedAnimusToken);
    expect(observerDetails.token).toBe(storedObserverToken);
    expect(observerDetails.url).toBe(storedObserverUrl);
    expect(voiceDetails.token).toBe(storedVoiceToken);
    expect(voiceDetails.url).toBe(storedVoiceUrl);

    // Ensure fetch was NOT called
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should fetch new details if stored Animus token is expired', async () => {
    // Store expired Animus token, but valid LK tokens
    const expiredTime = Date.now() - 1000; // Expired 1 second ago
    const validTime = Date.now() + 600 * 1000;
    sessionStorage.setItem(animusTokenKey, 'expired-animus-token');
    sessionStorage.setItem(animusExpiryKey, expiredTime.toString());
    sessionStorage.setItem(livekitObserverTokenKey, 'valid-observer-token');
    sessionStorage.setItem(livekitObserverUrlKey, 'wss://valid-observer.com');
    sessionStorage.setItem(livekitObserverExpiryKey, validTime.toString());
    // Omit voice for simplicity, fetch will get all anyway

    // Mock the fetch response for the refresh
    const mockResponse = createMockTokenResponse(
        { exp: Math.floor(Date.now() / 1000) + 3600 } // New animus token
    );
    mockFetchResponse(200, mockResponse);

    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Calling getToken should trigger fetch because Animus token is expired
    const animusToken = await authHandler.getToken();

    // Check results
    expect(animusToken).toBe(mockResponse.animus.token); // Got new token
    expect(fetch).toHaveBeenCalledTimes(1); // Fetch was called

    // Check storage was updated
    expect(sessionStorage.getItem(animusTokenKey)).toBe(mockResponse.animus.token);
    expect(sessionStorage.getItem(livekitObserverTokenKey)).toBe(mockResponse.livekit.observer.token); // All details updated
  });

  // Renamed and corrected test logic
  it('should fetch new details if stored LiveKit token is expired', async () => {
    // Store valid Animus token, but expired LK observer token
    const validTime = Date.now() + 600 * 1000;
    const expiredTime = Date.now() - 1000;
    sessionStorage.setItem(animusTokenKey, 'valid-animus-token');
    sessionStorage.setItem(animusExpiryKey, validTime.toString());
    sessionStorage.setItem(livekitObserverTokenKey, 'expired-observer-token');
    sessionStorage.setItem(livekitObserverUrlKey, 'wss://expired-observer.com');
    sessionStorage.setItem(livekitObserverExpiryKey, expiredTime.toString());

    // Mock the fetch response
    const mockResponse = createMockTokenResponse(
        { exp: Math.floor(Date.now() / 1000) + 3600 }, // New animus token
        { exp: Math.floor(Date.now() / 1000) + 3600 }  // New observer token
    );
    mockFetchResponse(200, mockResponse);

    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Calling getLiveKitDetails for observer should trigger fetch
    const observerDetails = await authHandler.getLiveKitDetails('observer');

    // Check results
    expect(observerDetails.token).toBe(mockResponse.livekit.observer.token); // Got new token
    expect(fetch).toHaveBeenCalledTimes(1); // Fetch was called

    // Check storage was updated
    expect(sessionStorage.getItem(animusTokenKey)).toBe(mockResponse.animus.token); // All details updated
    expect(sessionStorage.getItem(livekitObserverTokenKey)).toBe(mockResponse.livekit.observer.token);
  });


  it('should handle token fetch failure (non-ok response)', async () => {
    const errorBody = { error: 'Unauthorized Test' };
    mockFetchResponse(401, errorBody, false);
    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Check specific error message for non-ok response, including the body text
    // Note: Need to escape regex special characters in the expected body string if any
    await expect(authHandler.getToken()).rejects.toThrow(/^Failed to fetch details from provider: 401 Status 401\. {"error":"Unauthorized Test"}/);
    // Check storage was cleared (using a relevant key)
    expect(sessionStorage.getItem(animusTokenKey)).toBeNull();
  });

   it('should handle token fetch failure (network error)', async () => {
    mockFetchNetworkError('Failed to connect');
    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Check specific error message for network/other errors (wrapped message)
    await expect(authHandler.getToken()).rejects.toThrow(/^Error processing token details: Failed to connect/);
    // Check storage was cleared
    expect(sessionStorage.getItem(animusTokenKey)).toBeNull();
  });

  it('should handle invalid token response (missing required fields)', async () => {
    // Mock response missing the 'livekit.observer' field
    mockFetchResponse(200, { animus: { token: 'valid-token' }, livekit: { voice: { token: 'v', url: 'vu'} } });
    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Check specific error message for invalid structure
    await expect(authHandler.getToken()).rejects.toThrow(/^Invalid response from provider: missing required fields \(animus.token, livekit.observer.\*, livekit.voice.\*\)/);
    // Check storage was cleared
    expect(sessionStorage.getItem(animusTokenKey)).toBeNull();
  });

  it('should clear all details from storage', async () => {
     // Use the actual keys defined in the test setup
     const expiry = (Date.now() + 600000).toString();

     // Set dummy values for all keys used by AuthHandler
     sessionStorage.setItem(animusTokenKey, 'dummy-animus');
     sessionStorage.setItem(animusExpiryKey, expiry);
     sessionStorage.setItem(livekitObserverTokenKey, 'dummy-lk-obs');
     sessionStorage.setItem(livekitObserverUrlKey, 'dummy-lk-obs-url');
     sessionStorage.setItem(livekitObserverExpiryKey, expiry);
     sessionStorage.setItem(livekitVoiceTokenKey, 'dummy-lk-voice');
     sessionStorage.setItem(livekitVoiceUrlKey, 'dummy-lk-voice-url');
     sessionStorage.setItem(livekitVoiceExpiryKey, expiry);

     const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');
     authHandler.clearAllDetails();

     // Expect all keys used by AuthHandler to be removed
     expect(sessionStorage.getItem(animusTokenKey)).toBeNull();
     expect(sessionStorage.getItem(animusExpiryKey)).toBeNull();
     expect(sessionStorage.getItem(livekitObserverTokenKey)).toBeNull();
     expect(sessionStorage.getItem(livekitObserverUrlKey)).toBeNull();
     expect(sessionStorage.getItem(livekitObserverExpiryKey)).toBeNull();
     expect(sessionStorage.getItem(livekitVoiceTokenKey)).toBeNull();
     expect(sessionStorage.getItem(livekitVoiceUrlKey)).toBeNull();
     expect(sessionStorage.getItem(livekitVoiceExpiryKey)).toBeNull();

     // Check internal state is cleared
     expect((authHandler as any).animusToken).toBeNull();
     expect((authHandler as any).animusTokenExpiry).toBeNull();
     expect((authHandler as any).livekitObserverToken).toBeNull();
     expect((authHandler as any).livekitObserverUrl).toBeNull();
     expect((authHandler as any).livekitObserverExpiry).toBeNull();
     expect((authHandler as any).livekitVoiceToken).toBeNull();
     expect((authHandler as any).livekitVoiceUrl).toBeNull();
     expect((authHandler as any).livekitVoiceExpiry).toBeNull();
  });

  it('should load all details from storage on instantiation', () => {
    // Store valid details
    const expiryTime = Date.now() + 600 * 1000;
    const storedAnimusToken = 'pre-existing-animus';
    const storedObserverToken = 'pre-existing-observer';
    const storedObserverUrl = 'wss://pre-existing-observer.com';
    const storedVoiceToken = 'pre-existing-voice';
    const storedVoiceUrl = 'wss://pre-existing-voice.com';

    sessionStorage.setItem(animusTokenKey, storedAnimusToken);
    sessionStorage.setItem(animusExpiryKey, expiryTime.toString());
    sessionStorage.setItem(livekitObserverTokenKey, storedObserverToken);
    sessionStorage.setItem(livekitObserverUrlKey, storedObserverUrl);
    sessionStorage.setItem(livekitObserverExpiryKey, expiryTime.toString());
    sessionStorage.setItem(livekitVoiceTokenKey, storedVoiceToken);
    sessionStorage.setItem(livekitVoiceUrlKey, storedVoiceUrl);
    sessionStorage.setItem(livekitVoiceExpiryKey, expiryTime.toString());

    // Instantiate AFTER setting storage
    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Check internal state matches stored values
    expect((authHandler as any).animusToken).toBe(storedAnimusToken);
    expect((authHandler as any).animusTokenExpiry).toBe(expiryTime);
    expect((authHandler as any).livekitObserverToken).toBe(storedObserverToken);
    expect((authHandler as any).livekitObserverUrl).toBe(storedObserverUrl);
    expect((authHandler as any).livekitObserverExpiry).toBe(expiryTime);
    expect((authHandler as any).livekitVoiceToken).toBe(storedVoiceToken);
    expect((authHandler as any).livekitVoiceUrl).toBe(storedVoiceUrl);
    expect((authHandler as any).livekitVoiceExpiry).toBe(expiryTime);
  });

});