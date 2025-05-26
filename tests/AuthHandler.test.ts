import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { AuthHandler, AuthenticationError } from '../src/AuthHandler';

// Mock fetch globally
global.fetch = vi.fn();

// Helper to mock fetch responses
const mockFetchResponse = (status: number, body: any, ok: boolean = status >= 200 && status < 300) => {
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
    voice: { url: string; token: string; };
  };
}

// Creates a valid mock TokenResponse object
const createMockTokenResponse = (
    animusTokenPayload = { exp: Math.floor(Date.now() / 1000) + 3600 }, // Default 1hr expiry
    voiceTokenPayload = { exp: Math.floor(Date.now() / 1000) + 3600 },
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
    const mockResponse = createMockTokenResponse(
        { exp: Math.floor(Date.now() / 1000) + 1800 }, // Animus token
        { exp: Math.floor(Date.now() / 1000) + 1800 }  // Voice token
    );
    mockFetchResponse(200, mockResponse);

    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Call getToken (which triggers fetch)
    const animusToken = await authHandler.getToken();
    // Call getLiveKitDetails (should use cached data from the same fetch)
    const voiceDetails = await authHandler.getLiveKitDetails('voice');

    // Check returned values
    expect(animusToken).toBe(mockResponse.animus.token);
    expect(voiceDetails.token).toBe(mockResponse.livekit.voice.token);
    expect(voiceDetails.url).toBe(mockResponse.livekit.voice.url);

    // Check fetch call
    expect(fetch).toHaveBeenCalledTimes(1); // Only one fetch for all details
    expect(fetch).toHaveBeenCalledWith(tokenProviderUrl, expect.objectContaining({ method: 'POST' }));

    // Check storage was populated
    expect(sessionStorage.getItem(animusTokenKey)).toBe(mockResponse.animus.token);
    expect(sessionStorage.getItem(animusExpiryKey)).not.toBeNull();
    expect(sessionStorage.getItem(livekitVoiceTokenKey)).toBe(mockResponse.livekit.voice.token);
    expect(sessionStorage.getItem(livekitVoiceUrlKey)).toBe(mockResponse.livekit.voice.url);
    expect(sessionStorage.getItem(livekitVoiceExpiryKey)).not.toBeNull();
  });

  it('should return stored details if valid', async () => {
    // Pre-populate storage with valid tokens
    const expiryTime = Date.now() + 600 * 1000; // 10 minutes from now
    const storedAnimusToken = 'valid-animus-token';
    const storedVoiceToken = 'valid-voice-token';
    const storedVoiceUrl = 'wss://valid-voice.com';

    sessionStorage.setItem(animusTokenKey, storedAnimusToken);
    sessionStorage.setItem(animusExpiryKey, expiryTime.toString());
    sessionStorage.setItem(livekitVoiceTokenKey, storedVoiceToken);
    sessionStorage.setItem(livekitVoiceUrlKey, storedVoiceUrl);
    sessionStorage.setItem(livekitVoiceExpiryKey, expiryTime.toString());

    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Get details
    const animusToken = await authHandler.getToken();
    const voiceDetails = await authHandler.getLiveKitDetails('voice');

    // Check returned values match stored values
    expect(animusToken).toBe(storedAnimusToken);
    expect(voiceDetails.token).toBe(storedVoiceToken);
    expect(voiceDetails.url).toBe(storedVoiceUrl);

    // Ensure fetch was NOT called
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should fetch new details if stored Animus token is expired', async () => {
    // Store expired Animus token, but valid LK voice token
    const expiredTime = Date.now() - 60 * 1000; // 1 minute ago
    const validTime = Date.now() + 600 * 1000;

    sessionStorage.setItem(animusTokenKey, 'expired-animus-token');
    sessionStorage.setItem(animusExpiryKey, expiredTime.toString());
    sessionStorage.setItem(livekitVoiceTokenKey, 'valid-voice-token');
    sessionStorage.setItem(livekitVoiceUrlKey, 'wss://valid-voice.com');
    sessionStorage.setItem(livekitVoiceExpiryKey, validTime.toString());
    // Omit voice for simplicity, fetch will get all anyway

    const mockResponse = createMockTokenResponse(
        { exp: Math.floor(Date.now() / 1000) + 3600 }, // New animus token
        { exp: Math.floor(Date.now() / 1000) + 3600 }  // New voice token
    );
    mockFetchResponse(200, mockResponse);

    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Calling getToken should trigger fetch
    const animusToken = await authHandler.getToken();

    // Check results
    expect(animusToken).toBe(mockResponse.animus.token); // Got new token
    expect(fetch).toHaveBeenCalledTimes(1); // Fetch was called

    // Check storage was updated
    expect(sessionStorage.getItem(animusTokenKey)).toBe(mockResponse.animus.token); // All details updated
    expect(sessionStorage.getItem(livekitVoiceTokenKey)).toBe(mockResponse.livekit.voice.token);
  });

  it('should fetch new details if stored LiveKit token is expired', async () => {
    // Store valid Animus token, but expired LK voice token
    const validTime = Date.now() + 600 * 1000;
    const expiredTime = Date.now() - 60 * 1000; // 1 minute ago

    sessionStorage.setItem(animusTokenKey, 'valid-animus-token');
    sessionStorage.setItem(animusExpiryKey, validTime.toString());
    sessionStorage.setItem(livekitVoiceTokenKey, 'expired-voice-token');
    sessionStorage.setItem(livekitVoiceUrlKey, 'wss://expired-voice.com');
    sessionStorage.setItem(livekitVoiceExpiryKey, expiredTime.toString());

    const mockResponse = createMockTokenResponse(
        { exp: Math.floor(Date.now() / 1000) + 3600 }, // New animus token
        { exp: Math.floor(Date.now() / 1000) + 3600 }  // New voice token
    );
    mockFetchResponse(200, mockResponse);

    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Calling getLiveKitDetails for voice should trigger fetch
    const voiceDetails = await authHandler.getLiveKitDetails('voice');

    // Check results
    expect(voiceDetails.token).toBe(mockResponse.livekit.voice.token); // Got new token
    expect(fetch).toHaveBeenCalledTimes(1); // Fetch was called

    // Check storage was updated
    expect(sessionStorage.getItem(animusTokenKey)).toBe(mockResponse.animus.token); // All details updated
    expect(sessionStorage.getItem(livekitVoiceTokenKey)).toBe(mockResponse.livekit.voice.token);
  });

  it('should handle fetch errors gracefully', async () => {
    mockFetchNetworkError('Network failure');
    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    await expect(authHandler.getToken()).rejects.toThrow('Network failure');
    // Check storage was cleared
    expect(sessionStorage.getItem(animusTokenKey)).toBeNull();
  });

  it('should handle HTTP error responses', async () => {
    mockFetchResponse(500, { error: 'Internal Server Error' }, false);
    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    await expect(authHandler.getToken()).rejects.toThrow(/Failed to fetch details from provider: 500/);
    // Check storage was cleared
    expect(sessionStorage.getItem(animusTokenKey)).toBeNull();
  });

  it('should handle invalid token response (missing required fields)', async () => {
    // Mock response missing the 'livekit.voice' field
    mockFetchResponse(200, { animus: { token: 'valid-token' }, livekit: { } });
    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Check specific error message for invalid structure
    await expect(authHandler.getToken()).rejects.toThrow(/^Invalid response from provider: missing required fields \(animus.token, livekit.voice.\*\)/);
    // Check storage was cleared
    expect(sessionStorage.getItem(animusTokenKey)).toBeNull();
  });

  it('should clear all details from storage', () => {
     const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');
     const expiry = (Date.now() + 600 * 1000).toString();

     // Pre-populate storage
     sessionStorage.setItem(animusTokenKey, 'dummy-animus');
     sessionStorage.setItem(animusExpiryKey, expiry);
     sessionStorage.setItem(livekitVoiceTokenKey, 'dummy-lk-voice');
     sessionStorage.setItem(livekitVoiceUrlKey, 'dummy-lk-voice-url');
     sessionStorage.setItem(livekitVoiceExpiryKey, expiry);

     // Clear all details
     authHandler.clearAllDetails();

     // Check storage was cleared
     expect(sessionStorage.getItem(animusTokenKey)).toBeNull();
     expect(sessionStorage.getItem(animusExpiryKey)).toBeNull();
     expect(sessionStorage.getItem(livekitVoiceTokenKey)).toBeNull();
     expect(sessionStorage.getItem(livekitVoiceUrlKey)).toBeNull();
     expect(sessionStorage.getItem(livekitVoiceExpiryKey)).toBeNull();

     // Check internal state was cleared
     expect((authHandler as any).animusToken).toBeNull();
     expect((authHandler as any).animusTokenExpiry).toBeNull();
     expect((authHandler as any).livekitVoiceToken).toBeNull();
     expect((authHandler as any).livekitVoiceUrl).toBeNull();
     expect((authHandler as any).livekitVoiceExpiry).toBeNull();
  });

  it('should load all details from storage on instantiation', () => {
    const expiryTime = Date.now() + 600 * 1000; // 10 minutes from now
    const storedAnimusToken = 'pre-existing-animus';
    const storedVoiceToken = 'pre-existing-voice';
    const storedVoiceUrl = 'wss://pre-existing-voice.com';

    sessionStorage.setItem(animusTokenKey, storedAnimusToken);
    sessionStorage.setItem(animusExpiryKey, expiryTime.toString());
    sessionStorage.setItem(livekitVoiceTokenKey, storedVoiceToken);
    sessionStorage.setItem(livekitVoiceUrlKey, storedVoiceUrl);
    sessionStorage.setItem(livekitVoiceExpiryKey, expiryTime.toString());

    const authHandler = new AuthHandler(tokenProviderUrl, 'sessionStorage');

    // Check internal state was loaded correctly
    expect((authHandler as any).animusToken).toBe(storedAnimusToken);
    expect((authHandler as any).animusTokenExpiry).toBe(expiryTime);
    expect((authHandler as any).livekitVoiceToken).toBe(storedVoiceToken);
    expect((authHandler as any).livekitVoiceUrl).toBe(storedVoiceUrl);
    expect((authHandler as any).livekitVoiceExpiry).toBe(expiryTime);
  });
});