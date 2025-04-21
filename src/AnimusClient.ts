import { AuthHandler, AuthenticationError } from './AuthHandler';
import { RequestUtil, ApiError } from './RequestUtil';
import { ChatModule, ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk } from './Chat';
import { MediaModule, MediaCompletionRequest, MediaCompletionResponse, MediaAnalysisRequest, MediaAnalysisResultResponse, MediaAnalysisStatusResponse } from './Media';

// Re-export error types for convenience
export { AuthenticationError, ApiError };

/**
 * Configuration options for the AnimusClient.
 */

/** Configuration specific to the Chat module */
export interface AnimusChatOptions {
  /** Required: Default model ID to use for chat completions if not specified in the request. */
  model: string;
  /** Required: The system message to always include at the beginning of the conversation. */
  systemMessage: string;
  /** Optional: Default temperature for chat completions. */
  temperature?: number;
  /** Optional: Default top_p for chat completions. */
  top_p?: number;
  /** Optional: Default max_tokens for chat completions. */
  max_tokens?: number;
  // Add other common chat parameters as needed
 /** Optional: Number of past messages (excluding system message) to maintain internally for context. Defaults to 0 (no history). */
 historySize?: number;
}

/** Configuration specific to the Media (Vision) module */
export interface AnimusVisionOptions {
  /** Required: Default model ID to use for vision requests (completions, analysis) if not specified in the request. */
  model: string;
  /** Optional: Default temperature for media completions. */
  temperature?: number;
  // Add other common vision parameters as needed
}


export interface AnimusClientOptions {
  /**
   * Required: URL string pointing to the client's backend Token Proxy endpoint.
   * This endpoint is responsible for securely fetching the access token.
   */
  tokenProviderUrl: string;

  /**
   * Optional: Base URL for the Animus AI API.
   * Defaults to 'https://api.animusai.co/v3'.
   */
  apiBaseUrl?: string;

  /**
   * Optional: Configuration defaults for the Chat module.
   * If provided, `model` and `systemMessage` are required within this object.
   */
  chat?: AnimusChatOptions;

  /**
   * Optional: Configuration defaults for the Vision module.
   * If provided, `model` is required within this object.
   */
  vision?: AnimusVisionOptions;

  /**
   * Optional: Specifies where to store the fetched access token.
   * 'sessionStorage': Cleared when the browser tab is closed (default).
   * 'localStorage': Persists across browser sessions.
   */
  tokenStorage?: 'localStorage' | 'sessionStorage';

}

/**
 * Animus Javascript SDK Client for browser environments.
 */
export class AnimusClient {
  // Define a type for processed options where top-level are required, nested are optional
  private options: Omit<Required<AnimusClientOptions>, 'chat' | 'vision'> & {
      chat?: AnimusChatOptions;
      vision?: AnimusVisionOptions;
  };

  // Internal modules
  private authHandler: AuthHandler;
  private requestUtil: RequestUtil;

  /** Access Chat API methods. */
  public readonly chat: ChatModule;
  /** Access Media (Vision) API methods. */
  public readonly media: MediaModule;

  /**
   * Creates an instance of the AnimusClient.
   * @param options - Configuration options for the SDK.
   */
  constructor(options: AnimusClientOptions) {
    if (!options.tokenProviderUrl) {
      throw new Error('AnimusClient requires a `tokenProviderUrl` in options.');
    }
    // Validate nested configurations if provided
    if (options.chat) {
        if (typeof options.chat.model !== 'string' || options.chat.model.trim() === '') {
            throw new Error('AnimusClient requires `chat.model` if `chat` options are provided.');
        }
        if (typeof options.chat.systemMessage !== 'string' || options.chat.systemMessage.trim() === '') {
            throw new Error('AnimusClient requires `chat.systemMessage` if `chat` options are provided.');
        }
    }
    if (options.vision) {
        if (typeof options.vision.model !== 'string' || options.vision.model.trim() === '') {
            throw new Error('AnimusClient requires `vision.model` if `vision` options are provided.');
        }
    }

    // Apply defaults and structure options
    // Use Required<> carefully, maybe define a processed options type later
    this.options = {
      // Required top-level
      tokenProviderUrl: options.tokenProviderUrl,
      // Optional top-level with defaults
      apiBaseUrl: options.apiBaseUrl ?? 'https://api.animusai.co/v3',
      tokenStorage: options.tokenStorage ?? 'sessionStorage',
     // Optional nested configs (pass through if provided)
     chat: options.chat,
     vision: options.vision,
    };

    // Initialize internal modules
    this.authHandler = new AuthHandler(this.options.tokenProviderUrl, this.options.tokenStorage);
    this.requestUtil = new RequestUtil(this.options.apiBaseUrl, this.authHandler);

    // Pass relevant config to modules
    this.chat = new ChatModule(
        this.requestUtil,
       this.options.chat // Pass the whole chat config object (or undefined)
   );
   this.media = new MediaModule(
        this.requestUtil,
        this.options.vision // Pass the whole vision config object (or undefined)
    );

    console.log('AnimusClient initialized.');
  }

  /**
   * Clears any stored authentication token.
   */
  public clearAuthToken(): void {
    this.authHandler.clearToken();
    console.log('Cleared stored authentication token.');
  }

  // --- Direct access via modules ---
  // Methods like chat.completions and media.analyze are accessed via
  // client.chat.completions(...) and client.media.analyze(...)
}

// Re-export types from their respective modules
// export type { AnimusClientOptions } from './AnimusClient'; // Removed - Interface is already exported
export type {
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk
} from './Chat';
export type {
  MediaMessage,
  MediaCompletionRequest,
  MediaCompletionResponse,
  MediaAnalysisRequest,
  MediaAnalysisResultResponse,
  MediaAnalysisStatusResponse
} from './Media';