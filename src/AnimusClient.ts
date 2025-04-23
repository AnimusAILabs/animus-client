import { AuthHandler, AuthenticationError, LiveKitContext } from './AuthHandler';
import { RequestUtil, ApiError } from './RequestUtil';
import { ChatModule, ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk } from './Chat';
import { MediaModule, MediaCompletionRequest, MediaCompletionResponse, MediaAnalysisRequest, MediaAnalysisResultResponse, MediaAnalysisStatusResponse } from './Media';

// Re-export error types for convenience
export { AuthenticationError, ApiError };

/**
 * Configuration options for the AnimusClient.
 */

/** Configuration specific to the Chat module, allowing defaults for common API parameters. */
export interface AnimusChatOptions {
  // --- Core Required ---
  /** Required: Default model ID to use for chat completions if not specified in the request. Example: "animuslabs/Vivian-llama3.1-70b-1.0-fp8" */
  model: string;
  /** Required: The system message to always include at the beginning of the conversation. */
  systemMessage: string;

  // --- Optional Defaults for API Parameters ---
  /** Optional: Adjusts randomness. Lower values = more predictable. Default: 1 */
  temperature?: number;
  /** Optional: Filters token set by cumulative probability. Default: 1 */
  top_p?: number;
  /** Optional: Number of alternate responses to generate. Default: 1 */
  n?: number; // Note: API docs say integer, using number in TS
  /** Optional: Max tokens in the generated response. No default (model-specific). */
  max_tokens?: number; // Note: API docs say integer, using number in TS
  /** Optional: Stop sequences. Signals model to stop generation. Default: null */
  stop?: string[];
  /** Optional: Stream response back as it's generated. Default: false */
  stream?: boolean;
  /** Optional: Penalizes new words based on existing presence. Positive values discourage repetition. Default: 1 */
  presence_penalty?: number;
  /** Optional: Penalizes words based on frequency to encourage diversity. Default: 1 */
  frequency_penalty?: number;
  /** Optional: Generate multiple completions server-side and return the best. Default: 1 */
  best_of?: number; // Note: API docs say integer, using number in TS
   /** Optional: Limits consideration to top k tokens. Default: 40 */
  top_k?: number; // Note: API docs say integer, using number in TS
  /** Optional: Penalizes repeating tokens. Default: 1 */
  repetition_penalty?: number;
  /** Optional: Minimum probability threshold for token consideration. Default: 0 */
  min_p?: number;
  /** Optional: Adjusts impact of sequence length. Default: 1 */
  length_penalty?: number;
  /**
   * Optional: Enable/disable content moderation.
   * When true (default), checks response for harmful content (see `compliance_violations` in response).
   * Set to false to disable moderation.
   * Default: true
   */
  compliance?: boolean;

  // --- SDK Specific ---
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
    this.authHandler.clearAllDetails();
    console.log('Cleared stored authentication token.');
  }

  // --- Direct access via modules ---
  // Methods like chat.completions and media.analyze are accessed via
  // client.chat.completions(...) and client.media.analyze(...)

  /**
   * Retrieves the current valid LiveKit URL and token, fetching new details if necessary.
   * This internally uses the AuthHandler which manages token expiry and refresh for the specified context.
   * @param context - The LiveKit context ('observer' or 'voice') for which to get details.
   * @returns An object containing the LiveKit URL and token for the specified context.
   * @throws {AuthenticationError} If valid details cannot be obtained.
   */
  public async getLiveKitDetails(context: LiveKitContext): Promise<import('./AuthHandler').LiveKitDetails> {
      return this.authHandler.getLiveKitDetails(context);
  }
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