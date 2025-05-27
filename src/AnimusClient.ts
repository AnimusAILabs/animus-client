import { EventEmitter } from 'eventemitter3';
import {
    Room,
    RoomEvent,
    ConnectionState,
    RemoteParticipant,
    DataPacket_Kind,
    TextStreamReader, // Import TextStreamReader
    LocalParticipant, // Import LocalParticipant if needed for sendText
    RoomConnectOptions, // Import RoomConnectOptions
    LogLevel, // Optional: for LiveKit logging
} from 'livekit-client';

// ... other imports remain the same
import { AuthHandler, AuthenticationError, LiveKitContext, LiveKitDetails } from './AuthHandler';
import { RequestUtil, ApiError } from './RequestUtil';
import { ChatModule, ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk, Tool, ChatMessage, ToolCall } from './Chat'; // Import Tool, ChatMessage and ToolCall
import { MediaModule, MediaCompletionRequest, MediaCompletionResponse, MediaAnalysisRequest, MediaAnalysisResultResponse, MediaAnalysisStatusResponse } from './Media';

// Re-export error types for convenience
export { AuthenticationError, ApiError };

// --- Define Module-Specific Options Interfaces ---

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
  
  /**
   * Optional: Enable/disable reasoning output.
   * When true, adds "reasoning": true and "show_reasoning": true to requests.
   * For non-streaming, this adds a 'reasoning' field to the response message.
   * For streaming, the thinking content is included directly in the stream.
   * Default: false
   */
  reasoning?: boolean;

  // --- SDK Specific ---
  /** Optional: Number of past messages (excluding system message) to maintain internally for context. Defaults to 0 (no history). */
  historySize?: number;

  /** Optional: A list of tools the model may call. Currently, only functions are supported. */
  tools?: Tool[];

  /**
   * Optional: Enable automatic conversational turns feature
   * When true, enables server-side conversation analysis with default settings
   * When an object, provides detailed configuration for the conversational turns feature
   * When false/undefined, disables the feature
   * Default: false
   */
  autoTurn?: boolean | import('./conversational-turns/types').ConversationalTurnsConfig;
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

// --- Unified Stream Event Definitions ---


/** Defines the event map for the AnimusClient emitter. */
export type AnimusClientEventMap = {
    // Conversational Turn Events
    conversationalTurnStart: (data: { content: string; turnIndex: number; totalTurns: number }) => void;
    conversationalTurnComplete: (data: { content: string; turnIndex: number; totalTurns: number }) => void;
    conversationalTurnsCanceled: (data: { canceledTurns: number }) => void;
    conversationalTurnsComplete: () => void;
    
    // Standard Message Events (Event-Driven Architecture)
    messageStart: (data: {
      conversationId: string;
      messageType: 'regular' | 'auto' | 'followup';
      content: string;
      turnIndex?: number;
      totalTurns?: number;
    }) => void;
    messageTokens: (data: { content: string }) => void;
    messageProgress: (data: { content: string; isComplete: boolean }) => void;
    messageComplete: (data: {
      conversationId: string;
      messageType?: 'regular' | 'auto' | 'followup';
      content: string;
      reasoning?: string;
      toolCalls?: ToolCall[];
      imagePrompt?: string;
      turnIndex?: number;
      totalTurns?: number;
      totalMessages?: number;
    }) => void;
    messageError: (data: {
      conversationId: string;
      messageType?: 'regular' | 'auto' | 'followup';
      error: Error | string;
      turnIndex?: number;
      totalTurns?: number;
    }) => void;
    
    // Image Generation Events
    imageGenerationStart: (data: { prompt: string }) => void;
    imageGenerationComplete: (data: { prompt: string; imageUrl: string }) => void;
    imageGenerationError: (data: { prompt: string; error: Error | string }) => void;
};


/**
* Animus Javascript SDK Client for browser environments.
* Emits events for Observer connection status and incoming streams.
*/
export class AnimusClient extends EventEmitter<AnimusClientEventMap> {
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
      super(); // <-- Initialize EventEmitter
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
        this.options.chat,
        // Pass generateImage method to standardize image generation
        this.generateImage.bind(this),
        // Pass event emitter for conversational turn events
        (event: string, data: any) => this.emit(event as keyof AnimusClientEventMap, data)
    );
    this.media = new MediaModule(
        this.requestUtil,
        this.options.vision
    );

    console.log(`AnimusClient initialized.`);
  }

  /**
   * Clears any stored authentication token.
   */
  public clearAuthToken(): void {
    this.authHandler.clearAllDetails();
    console.log('Cleared stored authentication token.');
  }

  /**
   * Retrieves the current valid LiveKit URL and token, fetching new details if necessary.
   * This internally uses the AuthHandler which manages token expiry and refresh for the specified context.
   * @param context - The LiveKit context ('voice') for which to get details.
   * @returns An object containing the LiveKit URL and token for the specified context.
   * @throws {AuthenticationError} If valid details cannot be obtained.
   */
  public async getLiveKitDetails(context: LiveKitContext): Promise<LiveKitDetails> {
      return this.authHandler.getLiveKitDetails(context);
  }

  
  /**
   * Updates the chat configuration that will be used for future requests.
   * This allows dynamically changing system message, temperature, etc. without recreating the client.
   * @param config New chat configuration options
   */
  public updateChatConfig(config: Partial<AnimusChatOptions>): void {
    // Skip if no config provided
    if (!config) return;
    
    // Create new chat options by merging existing with new
    const existingConfig = this.options.chat || {} as AnimusChatOptions;
    
    // We need to ensure model and systemMessage are present
    this.options.chat = {
      ...existingConfig,
      ...config,
      // Ensure required fields are present after merge
      model: config.model || existingConfig.model || '',
      systemMessage: config.systemMessage || existingConfig.systemMessage || ''
    };

    // Make sure required options are still present
    const chatOptions = this.options.chat;
    if (!chatOptions?.model || !chatOptions?.systemMessage) {
      throw new Error('Chat configuration must include model and systemMessage');
    }

    // Update the chat module with new config
    if (this.chat && this.options.chat) {
      this.chat.updateConfig(this.options.chat);
    }

    console.log('[Animus SDK] Chat configuration updated:', this.options.chat);
  }

  /**
   * Updates compliance configuration parameters
   * @param config New compliance configuration
   */
  public updateComplianceConfig(config: { enabled: boolean }): void {
    // Skip if no config provided
    if (!config) return;

    // If chat options don't exist yet, create them
    if (!this.options.chat) {
      throw new Error('Cannot update compliance config: chat options not initialized');
    }

    // Update the compliance setting
    this.options.chat.compliance = config.enabled;
    
    // Update the chat module with new config
    if (this.chat && this.options.chat) {
      this.chat.updateConfig(this.options.chat);
    }

    console.log('[Animus SDK] Compliance configuration updated:', config);
  }


  /**
   * Generates an image based on the provided prompt.
   * Returns the URL of the generated image and adds it to chat history.
   *
   * @param prompt - The text prompt to generate an image from
   * @returns A Promise resolving to the URL of the generated image
   * @throws {ApiError} If the image generation fails
   */
  public async generateImage(prompt: string): Promise<string> {
      if (!prompt || prompt.trim() === '') {
          throw new Error('Image generation requires a non-empty prompt');
      }

      try {
          // Make the request to generate the image
          // We don't specify a specific response type to handle different formats
          const response = await this.requestUtil.request(
              'POST',
              '/generate/image',
              { prompt: prompt },
              false
          );

          let imageUrl: string | null = null;

          // Handle different response formats
          if (response.output && Array.isArray(response.output) && response.output.length > 0) {
              imageUrl = response.output[0];
          } else if (response.output && typeof response.output === 'string') {
              imageUrl = response.output;
          } else if (response.outputs && Array.isArray(response.outputs) && response.outputs.length > 0) {
              imageUrl = response.outputs[0];
          }

          // If no valid URL was found, throw an error
          if (!imageUrl) {
              console.error('[Animus SDK] Invalid image generation response format:', response);
              throw new Error('No image URL found in server response');
          }

          console.log('[Animus SDK] Generated image URL:', imageUrl);
          
          // If the chat module is available, add the image to chat history
          if (this.chat) {
              // Add image message as an assistant response to history
              this.chat.addAssistantResponseToHistory(
                  `<image description='${prompt}' />`,
                  null, // No compliance violations
                  undefined, // No tool calls
                  undefined, // No group metadata
                  null // No reasoning
              );
          }
          
          return imageUrl;
      } catch (error) {
          console.error('[Animus SDK] Error generating image:', error);
          throw error instanceof ApiError
              ? error
              : new ApiError(`Failed to generate image: ${error instanceof Error ? error.message : String(error)}`, 0, error);
      }
}
}

// Re-export types from their respective modules
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

// Add Observer specific types for export
export interface ObserverStreamData { // For streamAggregation = 'chunk'
    participantIdentity: string;
    topic: string;
    stream: AsyncIterable<string>; // Yields raw JSON string chunks
}