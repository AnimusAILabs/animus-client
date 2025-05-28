import type { Tool, ToolCall } from '../chat/types';

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
  autoTurn?: boolean | import('../conversational-turns/types').ConversationalTurnsConfig;
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