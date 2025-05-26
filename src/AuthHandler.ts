import { jwtDecode } from 'jwt-decode';

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

/** Decoded JWT payload structure (only need 'exp') */
interface JwtPayload {
  exp: number; // Expiration time as a Unix timestamp (seconds)
  // Other claims ignored
}

/** Structure for a single LiveKit context (Observer or Voice) */
interface LiveKitContextDetails {
    url: string;
    token: string;
}

/** Structure expected from the token provider URL */
interface TokenResponse {
  animus: {
    token: string;
  };
  livekit: {
    voice: LiveKitContextDetails;
  };
}

/** Structure returned by getLiveKitDetails */
export interface LiveKitDetails {
    url: string;
    token: string;
}

/** Type for the LiveKit context */
export type LiveKitContext = 'voice';


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
 * Handles fetching, storing, and refreshing authentication tokens (Animus and LiveKit)
 * from the provider URL by decoding JWT expiry times.
 */
export class AuthHandler {
  private tokenProviderUrl: string;
  private tokenStore: TokenStore;

  // Store Animus details
  private animusToken: string | null = null;
  private animusTokenExpiry: number | null = null; // Expiry time in milliseconds

  // Store LiveKit details separately for each context
  private livekitVoiceToken: string | null = null;
  private livekitVoiceUrl: string | null = null;
  private livekitVoiceExpiry: number | null = null; // Expiry time in milliseconds


  // Storage keys
  private readonly animusTokenKey = 'animus_sdk_auth_token';
  private readonly animusExpiryKey = 'animus_sdk_auth_expiry';

  private readonly livekitVoiceTokenKey = 'animus_sdk_lk_voice_token';
  private readonly livekitVoiceUrlKey = 'animus_sdk_lk_voice_url';
  private readonly livekitVoiceExpiryKey = 'animus_sdk_lk_voice_expiry';


  // Buffer time (fetch token this many milliseconds before actual expiry)
  private readonly bufferTime = 60 * 1000; // 60 seconds

  constructor(tokenProviderUrl: string, storageType: 'localStorage' | 'sessionStorage') {
    this.tokenProviderUrl = tokenProviderUrl;
    this.tokenStore = new TokenStore(storageType);
    this.loadDetailsFromStorage();
  }

  /**
   * Loads all details from storage if available.
   */
  private loadDetailsFromStorage(): void {
    this.animusToken = this.tokenStore.getItem(this.animusTokenKey);
    const animusExp = this.tokenStore.getItem(this.animusExpiryKey);
    this.animusTokenExpiry = animusExp ? parseInt(animusExp, 10) : null;

    // Load Voice details
    this.livekitVoiceToken = this.tokenStore.getItem(this.livekitVoiceTokenKey);
    this.livekitVoiceUrl = this.tokenStore.getItem(this.livekitVoiceUrlKey);
    const voiceExp = this.tokenStore.getItem(this.livekitVoiceExpiryKey);
    this.livekitVoiceExpiry = voiceExp ? parseInt(voiceExp, 10) : null;

    console.log('AuthHandler: Loaded details from storage.', {
        hasAnimusToken: !!this.animusToken,
        hasLivekitVoiceToken: !!this.livekitVoiceToken,
        animusExpires: this.animusTokenExpiry ? new Date(this.animusTokenExpiry).toISOString() : null,
        voiceExpires: this.livekitVoiceExpiry ? new Date(this.livekitVoiceExpiry).toISOString() : null,
    });
  }

  /**
   * Fetches new tokens and details from the configured provider URL.
   * Stores the details and calculated expiry times.
   * @throws {AuthenticationError} If fetching or processing fails.
   */
  private async fetchAndStoreDetails(): Promise<void> {
    console.log('AuthHandler: Fetching new Animus and LiveKit details...');
    try {
      // Use POST as before, adjust if your endpoint uses GET
      const response = await fetch(this.tokenProviderUrl, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        // body: JSON.stringify({}) // If needed
      });

      if (!response.ok) {
        let errorBody = 'Failed to fetch details';
        try { errorBody = await response.text(); } catch (_) { /* Ignore */ }
        throw new AuthenticationError(`Failed to fetch details from provider: ${response.status} ${response.statusText}. ${errorBody}`);
      }

      const data = await response.json() as TokenResponse;

      // Validate the structure
      if (!data.animus?.token ||
          !data.livekit?.voice?.token || !data.livekit?.voice?.url) {
        console.error("AuthHandler: Invalid response structure received:", data);
        throw new AuthenticationError('Invalid response from provider: missing required fields (animus.token, livekit.voice.*)');
      }

      // Decode tokens to get expiry
      let animusPayload: JwtPayload;
      let voicePayload: JwtPayload;
      try {
        animusPayload = jwtDecode<JwtPayload>(data.animus.token);
        voicePayload = jwtDecode<JwtPayload>(data.livekit.voice.token);
      } catch (decodeError) {
         console.error("AuthHandler: Error decoding JWT:", decodeError);
         throw new AuthenticationError(`Invalid token received, failed to decode: ${decodeError instanceof Error ? decodeError.message : String(decodeError)}`);
      }


      if (!animusPayload.exp || !voicePayload.exp) {
          throw new AuthenticationError('Invalid token(s) received: missing exp claim.');
      }

      // Store Animus details
      this.animusToken = data.animus.token;
      this.animusTokenExpiry = (animusPayload.exp * 1000) - this.bufferTime;
      this.tokenStore.setItem(this.animusTokenKey, this.animusToken);
      this.tokenStore.setItem(this.animusExpiryKey, this.animusTokenExpiry.toString());

      // Store Voice details
      this.livekitVoiceToken = data.livekit.voice.token;
      this.livekitVoiceUrl = data.livekit.voice.url;
      this.livekitVoiceExpiry = (voicePayload.exp * 1000) - this.bufferTime;
      this.tokenStore.setItem(this.livekitVoiceTokenKey, this.livekitVoiceToken);
      this.tokenStore.setItem(this.livekitVoiceUrlKey, this.livekitVoiceUrl);
      this.tokenStore.setItem(this.livekitVoiceExpiryKey, this.livekitVoiceExpiry.toString());


      console.log('AuthHandler: Successfully fetched and stored new details.', {
          animusExpires: new Date(this.animusTokenExpiry).toISOString(),
          voiceExpires: new Date(this.livekitVoiceExpiry).toISOString(),
      });

    } catch (error) {
      this.clearAllDetails(); // Clear potentially invalid details on fetch failure
      if (error instanceof AuthenticationError) {
        throw error;
      }
      // Wrap other errors (like network issues)
      throw new AuthenticationError(`Error processing token details: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Checks if the Animus token is expired or nearing expiry (within buffer). */
  private isAnimusTokenExpired(): boolean {
    const expired = !this.animusToken || !this.animusTokenExpiry || Date.now() >= this.animusTokenExpiry;
    // if (expired) console.log(`AuthHandler: Animus token is expired or missing. Now: ${Date.now()}, Expires: ${this.animusTokenExpiry}`);
    return expired;
  }

   /** Checks if the LiveKit token for a specific context is expired or nearing expiry (within buffer). */
   private isLiveKitTokenExpired(context: LiveKitContext): boolean {
       let token: string | null;
       let expiry: number | null;

       if (context === 'voice') {
           token = this.livekitVoiceToken;
           expiry = this.livekitVoiceExpiry;
       } else {
           console.error(`AuthHandler: Invalid LiveKit context provided to isLiveKitTokenExpired: ${context}`);
           return true; // Treat invalid context as expired
       }

       const expired = !token || !expiry || Date.now() >= expiry;
       // if (expired) console.log(`AuthHandler: LiveKit token for ${context} is expired or missing. Now: ${Date.now()}, Expires: ${expiry}`);
       return expired;
   }

  /**
   * Retrieves the current valid Animus access token, fetching new details if necessary.
   * @returns A valid Animus access token.
   * @throws {AuthenticationError} If a valid token cannot be obtained.
   */
  public async getToken(): Promise<string> {
    if (this.isAnimusTokenExpired()) {
      console.log('AuthHandler: Animus token expired or missing, refreshing details...');
      await this.fetchAndStoreDetails(); // Refreshes both tokens
    }
    // After fetching (if needed), the token should be valid and non-null
    if (!this.animusToken) {
        // This should ideally not happen if fetchAndStoreDetails succeeded
        throw new AuthenticationError("AuthHandler: Failed to load or fetch a valid Animus token.");
    }
    return this.animusToken;
  }

  /**
   * Retrieves the current valid LiveKit URL and token for the specified context,
   * fetching new details if necessary.
   * @param context - The LiveKit context ('voice') for which to get details.
   * @returns An object containing the LiveKit URL and token for the specified context.
   * @throws {AuthenticationError} If valid details cannot be obtained.
   */
  public async getLiveKitDetails(context: LiveKitContext): Promise<LiveKitDetails> {
      if (this.isLiveKitTokenExpired(context)) {
          console.log(`AuthHandler: LiveKit token for ${context} expired or missing, refreshing all details...`);
          await this.fetchAndStoreDetails(); // Refreshes all tokens
      }

      let url: string | null;
      let token: string | null;

      if (context === 'voice') {
          url = this.livekitVoiceUrl;
          token = this.livekitVoiceToken;
      } else {
           // Should not happen if type checking is enforced, but good practice
          throw new AuthenticationError(`AuthHandler: Invalid LiveKit context requested: ${context}`);
      }

       // After fetching (if needed), details should be valid and non-null
      if (!url || !token) {
           // This should ideally not happen if fetchAndStoreDetails succeeded
          throw new AuthenticationError(`AuthHandler: Failed to load or fetch valid LiveKit details for context "${context}".`);
      }
      return { url, token };
  }


  /**
   * Clears all stored token and detail information.
   */
  public clearAllDetails(): void {
    console.log('AuthHandler: Clearing all stored details.');
    this.animusToken = null;
    this.animusTokenExpiry = null;
    this.livekitVoiceToken = null;
    this.livekitVoiceUrl = null;
    this.livekitVoiceExpiry = null;

    this.tokenStore.removeItem(this.animusTokenKey);
    this.tokenStore.removeItem(this.animusExpiryKey);
    this.tokenStore.removeItem(this.livekitVoiceTokenKey);
    this.tokenStore.removeItem(this.livekitVoiceUrlKey);
    this.tokenStore.removeItem(this.livekitVoiceExpiryKey);
  }
}