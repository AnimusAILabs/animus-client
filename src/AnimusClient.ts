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
import { ChatModule, ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk } from './Chat'; // Remove AnimusChatOptions import if present
import { MediaModule, MediaCompletionRequest, MediaCompletionResponse, MediaAnalysisRequest, MediaAnalysisResultResponse, MediaAnalysisStatusResponse } from './Media'; // Remove AnimusVisionOptions import if present

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


/** Configuration specific to the LiveKit Observer connection */
export interface AnimusObserverOptions { // This definition is correct
    /** Required: Set to true to enable the Observer connection. */
    enabled: boolean;
    // Future options like custom topic, reconnection settings could go here
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
     * Optional: Configuration for the LiveKit Observer connection.
     * If provided and `enabled` is true, the SDK will manage the Observer connection.
     */
    observer?: AnimusObserverOptions; // <-- Added Observer options

    /**
     * Optional: Specifies where to store the fetched access token.
     * 'sessionStorage': Cleared when the browser tab is closed (default).
     * 'localStorage': Persists across browser sessions.
     */
    tokenStorage?: 'localStorage' | 'sessionStorage';
}

// --- Unified Stream Event Definitions ---

/** Identifies the source of a stream */
export type StreamSource = 'observer' | 'http';

// --- Observer Stream Event Definitions (NEW) ---

/** Data payload for the 'observerChunk' event. */
export interface ObserverChunkData {
    participantIdentity: string;
    /** The raw chunk object received from the Observer. */
    chunk: ChatCompletionChunk;
    /** Content delta from the chunk, if any. */
    deltaContent?: string;
    /** Compliance violations associated with this stream (consistent across chunks). */
    compliance_violations?: string[] | null;
}

/** Data payload for the 'observerComplete' event. */
export interface ObserverCompleteData {
    participantIdentity: string;
    /** Final aggregated content of the stream from the Observer. */
    fullContent: string;
    /** Final usage statistics, if available from the Observer stream. */
    usage?: ChatCompletionResponse['usage'] | null;
    /** Final compliance violations status for the Observer stream. */
    compliance_violations?: string[] | null;
}

/** Data payload for the 'observerError' event. */
export interface ObserverErrorData {
    participantIdentity: string;
    /** The error message related to the Observer stream. */
    error: string;
}


/** Defines the event map for the AnimusClient emitter. */
export type AnimusClientEventMap = {
    // Observer Stream Events (NEW)
    observerChunk: (data: ObserverChunkData) => void;
    observerComplete: (data: ObserverCompleteData) => void;
    observerStreamError: (data: ObserverErrorData) => void; // Renamed to avoid conflict

    // Observer Connection Status Events
    observerConnecting: () => void;
    observerConnected: () => void;
    observerDisconnected: (reason?: string) => void; // Keep reason optional
    observerReconnecting: () => void;
    observerReconnected: () => void;
    observerError: (error: string) => void; // Keep simple error string
};


/**
* Animus Javascript SDK Client for browser environments.
* Emits events for Observer connection status and incoming streams.
*/
export class AnimusClient extends EventEmitter<AnimusClientEventMap> {
  // Define a type for processed options where top-level are required, nested are optional
  private options: Omit<Required<AnimusClientOptions>, 'chat' | 'vision' | 'observer'> & {
      chat?: AnimusChatOptions;
      vision?: AnimusVisionOptions;
      observer?: AnimusObserverOptions; // <-- Add observer to processed options
  };

  // Internal modules
  private authHandler: AuthHandler;
  private requestUtil: RequestUtil;

  /** Access Chat API methods. */
  public readonly chat: ChatModule;
  /** Access Media (Vision) API methods. */
  public readonly media: MediaModule;

  // --- Observer Specific Members ---
  private observerEnabled: boolean = false;
  private livekitRoom: Room | null = null;
  private observerConnectionState: ConnectionState = ConnectionState.Disconnected;
  private observerTopic: string = 'animus-observer'; // Default topic
  private currentObserverStreamContent: string = ''; // Accumulator for the current stream
  private currentStreamAccumulator: { [participantId: string]: string } = {}; // Accumulator per participant stream

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

        if (options.observer && typeof options.observer.enabled !== 'boolean') {
             console.warn('AnimusClient: `observer.enabled` must be a boolean. Observer disabled.');
             // Ensure observer object exists before setting enabled to false
             options.observer = { ...options.observer, enabled: false };
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
        observer: options.observer, // <-- Store observer options
    };

    // --- Initialize Observer State ---
    this.observerEnabled = this.options.observer?.enabled ?? false;

    // Initialize internal modules
    this.authHandler = new AuthHandler(this.options.tokenProviderUrl, this.options.tokenStorage);
    this.requestUtil = new RequestUtil(this.options.apiBaseUrl, this.authHandler);

    // Pass relevant config to modules
    // We'll need to pass a reference to the client or specific observer methods to ChatModule later
    this.chat = new ChatModule(
        this.requestUtil,
        this.options.chat,
        // Pass observer check and send functions
        this.isObserverConnected.bind(this),
        this.sendObserverText.bind(this)
    );
    this.media = new MediaModule(
        this.requestUtil,
        this.options.vision
    );

    console.log(`AnimusClient initialized. Observer enabled: ${this.observerEnabled}`);

    // --- Observer Connection is NOT initiated automatically ---
    // User must call connectObserverManually() if observer is enabled.
    // if (this.observerEnabled) {
    //     this.connectObserver(); // REMOVED automatic connection
    // }
  }

  /**
   * Clears any stored authentication token.
   * Also disconnects the observer if connected.
   */
  public clearAuthToken(): void {
    this.authHandler.clearAllDetails();
    console.log('Cleared stored authentication token.');
    if (this.observerEnabled && this.livekitRoom) {
        // Don't wait for disconnect, just initiate
        this.disconnectObserver();
    }
  }

  /**
   * Retrieves the current valid LiveKit URL and token, fetching new details if necessary.
   * This internally uses the AuthHandler which manages token expiry and refresh for the specified context.
   * @param context - The LiveKit context ('observer' or 'voice') for which to get details.
   * @returns An object containing the LiveKit URL and token for the specified context.
   * @throws {AuthenticationError} If valid details cannot be obtained.
   */
  public async getLiveKitDetails(context: LiveKitContext): Promise<LiveKitDetails> {
      return this.authHandler.getLiveKitDetails(context);
  }

  // --- Observer Connection Management ---

  private async connectObserver(): Promise<void> {
      // Prevent multiple connection attempts
      if (this.observerConnectionState !== ConnectionState.Disconnected) {
          console.warn(`Observer connection attempt ignored. Current state: ${this.observerConnectionState}`);
          return;
      }
      console.log('Attempting to connect to Observer...');
      this.updateObserverState(ConnectionState.Connecting);
      this.emit('observerConnecting');

      try {
          const details = await this.getLiveKitDetails('observer');
          this.livekitRoom = new Room({
               // logLevel is set statically via setLogLevel, not here
          });

          // Setup listeners *before* connecting
          this.setupObserverRoomListeners();

          // Connect to the room
          await this.livekitRoom.connect(details.url, details.token, {
              autoSubscribe: true, // Automatically subscribe to participants and their tracks/data
          });

          // State update (Connected) is handled by the 'ConnectionStateChanged' listener
          console.log('Observer connection request successful.');

      } catch (error) {
          console.error('Failed to initiate Observer connection:', error);
          this.updateObserverState(ConnectionState.Disconnected); // Reset state on failure
          this.emit('observerError', error instanceof Error ? error.message : String(error));
          this.emit('observerDisconnected', 'Connection failed'); // Also emit disconnected
          // Clean up room object if connection failed
          if (this.livekitRoom) {
              await this.livekitRoom.disconnect();
              this.livekitRoom = null;
          }
      }
  }

  private async disconnectObserver(): Promise<void> {
       if (!this.livekitRoom || this.observerConnectionState === ConnectionState.Disconnected) {
           console.log('Observer already disconnected or not initialized.');
           return;
       }
       console.log('Disconnecting Observer...');
       // Setting state immediately prevents race conditions if called multiple times
       this.updateObserverState(ConnectionState.Disconnected);
       await this.livekitRoom.disconnect(true); // true to stop tracks
       // Listener will fire 'observerDisconnected' event
       this.livekitRoom = null; // Clean up room reference
       console.log('Observer disconnect initiated.');
  }

  private setupObserverRoomListeners(): void {
      if (!this.livekitRoom) return;

      // Remove existing listeners to prevent duplicates if re-setup occurs
      this.livekitRoom.removeAllListeners(RoomEvent.ConnectionStateChanged);
      this.livekitRoom.removeAllListeners(RoomEvent.DataReceived); // Correct event name
      this.livekitRoom.removeAllListeners(RoomEvent.ParticipantConnected);
      this.livekitRoom.removeAllListeners(RoomEvent.ParticipantDisconnected);

      this.livekitRoom
          .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
              console.log(`Observer Connection State Changed: ${state}`);
              const oldState = this.observerConnectionState;
              this.updateObserverState(state);

              switch (state) {
                  case ConnectionState.Connected:
                      if (oldState === ConnectionState.Reconnecting) {
                          this.emit('observerReconnected');
                      } else {
                          this.emit('observerConnected');
                      }
                      // Register the stream handler *after* successful connection
                      this.registerObserverStreamHandler();
                      break;
                  case ConnectionState.Disconnected:
                      // Provide reason if available (e.g., from disconnect method or error)
                      this.emit('observerDisconnected');
                      // Room reference is nullified in disconnectObserver or connection failure handler
                      break;
                  case ConnectionState.Connecting:
                       this.emit('observerConnecting');
                       break;
                  case ConnectionState.Reconnecting:
                      this.emit('observerReconnecting');
                      break;
              }
          })
          .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant, kind?: DataPacket_Kind, topic?: string) => { // Correct event name
              // Primarily using registerTextStreamHandler, but log if unexpected data packets arrive
              if (topic !== this.observerTopic) {
                 console.log(`Observer: Received unexpected data packet (kind: ${kind}, topic: ${topic})`); // Use DataReceived event
              }
          })
          .on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
               console.log(`Observer: Participant connected: ${participant.identity}`);
               // Could potentially trigger stream handler registration if needed, but usually done on initial connect
          })
           .on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
               console.log(`Observer: Participant disconnected: ${participant.identity}`);
          });
  }

   private registerObserverStreamHandler(): void {
      if (!this.livekitRoom || this.observerConnectionState !== ConnectionState.Connected) {
          console.warn('Cannot register stream handler: Observer not connected.');
          return;
      }

      // Cannot reliably remove specific stream handlers by topic easily.
      // LiveKit manages handlers internally. Re-registering might replace or add.
      // If issues arise, a more complex handler management strategy might be needed.
      // For now, just register.

      console.log(`Registering text stream handler for topic: ${this.observerTopic}`);

      this.livekitRoom.registerTextStreamHandler(this.observerTopic, (reader: TextStreamReader, participantInfo) => {
          const participantId = participantInfo?.identity ?? 'unknown';
          const topic = reader.info.topic ?? this.observerTopic;
          // console.log(`Observer: Received OpenAI-style text stream from ${participantId} on topic ${topic}`);

          // Initialize accumulator for this specific participant stream using the class member
          //this.currentStreamAccumulator[participantId] = '';

          // Process stream chunk by chunk
          (async () => {
              let streamComplianceViolations: string[] | undefined = undefined; // Store compliance violations for this stream
              let finalUsage: ChatCompletionResponse['usage'] | undefined = undefined; // Store final usage

              try {
                  // Initialize accumulator for this specific participant stream
                  if (!this.currentStreamAccumulator[participantId]) {
                      this.currentStreamAccumulator[participantId] = '';
                  }

                  for await (const rawChunk of reader) {
                      const chunk = rawChunk.trim();

                      if (chunk === '[DONE]') {
                          // Get final content from the class member accumulator
                          const finalContent = this.currentStreamAccumulator[participantId] ?? '';
                          // Use the new ObserverCompleteData interface
                          const completeData: ObserverCompleteData = {
                              participantIdentity: participantId, // Add participant ID
                              fullContent: finalContent,
                              usage: finalUsage, // Include final usage
                              compliance_violations: streamComplianceViolations // Include final compliance status
                          };
                          this.emit('observerComplete', completeData); // Emit observer-specific event

                          // --- Add Assistant Response to History ---
                          // Add to history ONLY if there were no compliance violations
                          if (!streamComplianceViolations || streamComplianceViolations.length === 0) {
                              console.log(`[Animus SDK DEBUG] Observer stream complete (No Compliance Issues). Adding content length: ${finalContent.length} to history.`);
                              // Pass compliance status (which is null/empty) to history function
                              this.chat.addAssistantResponseToHistory(finalContent, streamComplianceViolations);
                          } else {
                              console.warn(`[Animus SDK DEBUG] Observer stream complete WITH Compliance Issues. Content NOT added to history. Violations: ${streamComplianceViolations.join(', ')}`);
                              // Even though not added, call history function with violations for consistency (it will handle the return)
                              this.chat.addAssistantResponseToHistory(finalContent, streamComplianceViolations);
                          }
                          // -----------------------------------------

                          // Clean up AFTER successful processing of [DONE]
                          delete this.currentStreamAccumulator[participantId];
                          console.log(`[Animus SDK DEBUG] Cleaned up accumulator for participant ${participantId} after [DONE]`);

                          break; // Exit loop on [DONE]
                      }

                      if (chunk) {
                          let jsonData = chunk;
                          if (chunk.startsWith('data: ')) {
                              jsonData = chunk.substring(5).trim();
                          }
                          if (!jsonData) continue;

                          try {
                              // Parse the chunk - it might contain content, metadata, or both
                              const parsedChunk = JSON.parse(jsonData) as ChatCompletionChunk; // Parse as the base type first

                              let deltaContent: string | undefined = undefined;
                              let currentChunkComplianceViolations: string[] | null | undefined = parsedChunk.compliance_violations;
                              let currentChunkUsage: ChatCompletionResponse['usage'] | null | undefined = parsedChunk.usage;
                              // Placeholder for potential future error field in chunk, assuming structure { error: string }
                              let errorMessage: string | undefined = (parsedChunk as any).error;


                              // 1. Check for content delta
                              if (parsedChunk.choices &&
                                  parsedChunk.choices.length > 0 &&
                                  parsedChunk.choices[0]?.delta &&
                                  parsedChunk.choices[0].delta.content !== undefined) {
                                  deltaContent = parsedChunk.choices[0].delta.content;
                              }

                              // 2. Update overall stream compliance status if found in this chunk
                              // (Since it's consistent, we only need to store it once)
                              if (currentChunkComplianceViolations && !streamComplianceViolations) {
                                  streamComplianceViolations = currentChunkComplianceViolations;
                                  console.log(`[Animus SDK DEBUG] Observer stream - Compliance violations status set:`, streamComplianceViolations);
                              }

                              // 3. Update final usage if present in this chunk
                              if (currentChunkUsage) {
                                  finalUsage = currentChunkUsage;
                              }

                              // 4. Handle errors if present in the chunk
                              if (errorMessage) {
                                  console.warn(`Observer: Received error in stream chunk from ${participantId}: ${errorMessage}`);
                                  // Emit observerStreamError
                                  this.emit('observerStreamError', {
                                      participantIdentity: participantId,
                                      error: `Received error in stream chunk: ${errorMessage}`
                                  });
                                  // Depending on desired behavior, you might 'continue' or 'break' here
                                  continue; // Continue processing other chunks for now
                              }


                              // --- Emit streamChunk ---
                              // Emit even if deltaContent is null, as chunk might contain metadata
                              const chunkData: ObserverChunkData = {
                                  participantIdentity: participantId, // Add participant ID
                                  chunk: parsedChunk,
                                  deltaContent: deltaContent,
                                  // Pass the consistent compliance status with every chunk
                                  compliance_violations: streamComplianceViolations
                              };
                              this.emit('observerChunk', chunkData); // Emit observer-specific event
                              // --------------------------

                              // Accumulate content AFTER emitting the chunk
                              if (deltaContent) {
                                  // Ensure accumulator exists before adding
                                  if (this.currentStreamAccumulator[participantId] === undefined) {
                                      this.currentStreamAccumulator[participantId] = '';
                                  }
                                  this.currentStreamAccumulator[participantId] += deltaContent;
                              }


                          } catch (parseError) {
                              console.warn(`Observer: Failed to parse chunk from ${participantId} as JSON: "${chunk}"`, parseError);
                              // Emit observerStreamError
                              this.emit('observerStreamError', {
                                  participantIdentity: participantId,
                                  error: `Failed to parse stream chunk: ${chunk}`
                              });
                          }
                      }
                  }
              } catch (streamError) {
                  console.error(`Observer: Error reading stream from ${participantId}:`, streamError);
                   // Emit observerStreamError
                  this.emit('observerStreamError', {
                      participantIdentity: participantId,
                      error: streamError instanceof Error ? streamError.message : String(streamError)
                  });
                  // Clean up accumulator on stream read error
                  delete this.currentStreamAccumulator[participantId];
                  console.log(`[Animus SDK DEBUG] Cleaned up accumulator for participant ${participantId} after stream error`);
              }
              // REMOVED finally block to prevent premature cleanup
          })();
      });
      console.log(`Text stream handler registered for topic: ${this.observerTopic}`);
  }


  private updateObserverState(newState: ConnectionState): void {
      if (this.observerConnectionState !== newState) {
          this.observerConnectionState = newState;
          console.log(`Observer state updated to: ${newState}`);
      }
  }

  // --- Public Observer Methods ---

  /**
   * Returns the current connection state of the LiveKit Observer.
   */
  public getObserverState(): ConnectionState {
      return this.observerConnectionState;
  }

  /**
   * Checks if the Observer is currently connected.
   * @returns true if the state is Connected, false otherwise.
   */
  public isObserverConnected(): boolean {
      return this.observerConnectionState === ConnectionState.Connected;
  }

  /**
   * Explicitly attempts to connect the Observer if it's enabled but not connected/connecting.
   */
  public async connectObserverManually(): Promise<void> {
      if (!this.observerEnabled) {
          throw new Error("Observer is not enabled in configuration.");
      }
      if (this.observerConnectionState !== ConnectionState.Disconnected) {
          console.log(`Observer cannot connect manually. Current state: ${this.observerConnectionState}`);
          return; // Or throw? For now, just log and return.
      }
      await this.connectObserver();
  }

   /**
   * Explicitly disconnects the Observer.
   */
  public async disconnectObserverManually(): Promise<void> {
      if (!this.observerEnabled) {
           console.warn("Observer is not enabled, cannot disconnect manually.");
           return;
      }
      if (this.observerConnectionState === ConnectionState.Disconnected) {
           console.log("Observer is already disconnected.");
           return;
      }
      await this.disconnectObserver();
  }


  // --- Internal method for ChatModule to send text ---
  /** @internal */
  private async sendObserverText(text: string): Promise<void> {
      // isObserverConnected check is done in ChatModule before calling this
      if (!this.livekitRoom || !this.livekitRoom.localParticipant) {
          // This should ideally not happen if isObserverConnected is true, but safeguard
          throw new Error("Internal Error: Observer room or local participant not available for sending.");
      }
      try {
          await this.livekitRoom.localParticipant.sendText(text, { topic: this.observerTopic });
          // console.log(`Sent text via Observer on topic ${this.observerTopic}`); // Reduce log noise
      } catch (error) {
          console.error(`Failed to send text via Observer: ${error}`);
          // Re-throw a more specific error for the caller (ChatModule)
          // Use status 0 to indicate a non-HTTP error source
          throw new ApiError(`Failed to send message via LiveKit Observer: ${error instanceof Error ? error.message : String(error)}`, 0, error);
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