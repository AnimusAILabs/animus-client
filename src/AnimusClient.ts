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
import { ChatModule, ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk, Tool, ChatMessage } from './Chat'; // Import Tool and ChatMessage
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
export interface AnimusObserverOptions {
    /** Required: Set to true to enable the Observer connection. */
    enabled: boolean;
    
    /** Seconds before checking if a user is inactive. Default: 120 */
    initial_inactivity_delay?: number;
    
    /** Multiplier for increasing the delay between subsequent inactivity checks. Default: 1.5 */
    backoff_multiplier?: number;
    
    /** Maximum number of inactivity messages to send during a period of user inactivity. Default: 2 */
    max_inactivity_messages?: number;
    
    /** Any other custom configuration options (for extensibility, though specific params are preferred) */
    [key: string]: any;
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

// No more image generation events, they've been removed in favor of direct awaitable method calls

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
    /** Final content of the message from the Observer. */
    fullContent: string;
    /** Final usage statistics, if available from the Observer message. */
    usage?: ChatCompletionResponse['usage'] | null;
    /** Final compliance violations status for the Observer message. */
    compliance_violations?: string[] | null;
    /** Observer metadata containing decision information */
    observer_metadata?: any;
    /** The original message content before processing */
    rawContent?: string;
}

/** Data payload for the 'observerError' event. */
export interface ObserverErrorData {
    participantIdentity: string;
    /** The error message related to the Observer stream. */
    error: string;
}


/** Data payload for the 'observerSessionEnded' event. */
export interface ObserverSessionEndedData {
    participantIdentity: string; // Though likely from the agent itself
    reason: 'max_messages_reached' | 'session_ended';
}

/** Defines the event map for the AnimusClient emitter. */
export type AnimusClientEventMap = {
    // Observer Stream Events (NEW)
    observerChunk: (data: ObserverChunkData) => void;
    observerComplete: (data: ObserverCompleteData) => void;
    observerStreamError: (data: ObserverErrorData) => void; // Renamed to avoid conflict
    observerSessionEnded: (data: ObserverSessionEndedData) => void; // New event

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
  
  // Default observer configuration values
  // These are kept for backward compatibility but no longer used for scheduling
  private observerConfig: {
    initial_inactivity_delay: number;
    backoff_multiplier: number;
    max_inactivity_messages: number;
    [key: string]: any; // Allow other custom keys
  } = {
    initial_inactivity_delay: 120, // Default: 120 seconds
    backoff_multiplier: 1.5,       // Default: 1.5
    max_inactivity_messages: 2,    // Default: 2 messages
  };

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
    
    // Apply custom observer configuration if provided
    if (this.options.observer) {
      // Apply observer configuration from options and send to backend if connected
      this.updateObserverConfig(this.options.observer);
      
      // If we're already connected somehow, make sure config is sent right away
      if (this.isObserverConnected()) {
        this.sendObserverConfigUpdate(this.options.observer)
          .catch(err => console.error('[Animus SDK] Failed to send initial observer config:', err));
      }
    }

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
        this.sendObserverText.bind(this),
        // We still pass resetUserActivity for compatibility but it's simplified
        this.resetUserActivity.bind(this),
        // Pass generateImage method to standardize image generation
        this.generateImage.bind(this)
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
          console.log(`[Animus SDK] Observer receiving message from ${participantId} on topic ${topic}`);
          (async () => {
              try {
                  // Read the whole message (should be a single message)
                  let firstMessage = '';
                  for await (const rawMessage of reader) {
                      // Since the observer sends one complete message, we just take the first one
                      if (!firstMessage) {
                          firstMessage = rawMessage.trim();
                          console.log(`[Animus SDK] Observer received message: ${firstMessage.substring(0, 200)}${firstMessage.length > 200 ? '...' : ''}`);
                          
                          // Process the complete message immediately
                          if (firstMessage) {
                              try {
                                  // Parse the message as a JSON object
                                  const parsedMessage = JSON.parse(firstMessage) as any; // Use 'any' for flexibility
                                  console.log('[Animus SDK] Observer parsed message:', JSON.stringify(parsedMessage, null, 2));

                                  // Check for proactive_stopped status first (which we'll emit as observerSessionEnded)
                                  if (parsedMessage.status === 'proactive_stopped' && parsedMessage.reason) {
                                      console.log(`[Animus SDK] Observer session ended. Reason: ${parsedMessage.reason}`);
                                      this.emit('observerSessionEnded', {
                                          participantIdentity: participantId, // Or a generic ID for the agent
                                          reason: parsedMessage.reason as 'max_messages_reached' | 'session_ended'
                                      });
                                  } else if (parsedMessage.choices || parsedMessage.observer_metadata) {
                                      // Handle regular proactive messages or messages with observer_metadata
                                      const observerMetadata = parsedMessage.observer_metadata;
                                      let displayContent = '';

                                      if (observerMetadata?.observer_message) {
                                          displayContent = observerMetadata.observer_message;
                                          console.log(`[Animus SDK] Using observer_message: "${displayContent}"`);
                                      } else if (parsedMessage.choices &&
                                              parsedMessage.choices.length > 0 &&
                                              parsedMessage.choices[0]?.message?.content) {
                                          const messageContent = parsedMessage.choices[0].message.content;
                                          if (messageContent.includes(']: assistant:')) {
                                              const match = messageContent.match(/\[[^\]]+\]:\s*assistant:\s*(.+)/);
                                              displayContent = match && match[1] ? match[1].trim() : messageContent;
                                          } else {
                                              displayContent = messageContent;
                                          }
                                      }

                                      const completeData: ObserverCompleteData = {
                                          participantIdentity: participantId,
                                          fullContent: displayContent,
                                          usage: parsedMessage.usage,
                                          compliance_violations: parsedMessage.compliance_violations,
                                          observer_metadata: observerMetadata || { is_proactive: true },
                                          rawContent: parsedMessage.choices?.[0]?.message?.content
                                      };

                                      if (displayContent && displayContent.trim().length > 0) {
                                          console.log(`[Animus SDK] Emitting observer message: "${displayContent}"`);
                                          this.emit('observerComplete', completeData);
                                          // Add to history if appropriate, marking it as from observer
                                          if (!parsedMessage.compliance_violations || parsedMessage.compliance_violations.length === 0) {
                                              console.log(`[Animus SDK] Adding observer message to history: "${displayContent}"`);
                                              this.chat.addAssistantResponseToHistory(displayContent, parsedMessage.compliance_violations, true);
                                          }
                                      } else {
                                          console.log(`[Animus SDK] Observer message has no displayable content - not emitting observerComplete event.`);
                                      }
                                  } else {
                                      console.warn('[Animus SDK] Received observer message with unknown structure:', parsedMessage);
                                  }

                              } catch (parseError) {
                                  console.error(`[Animus SDK] Failed to parse observer message: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                                  this.emit('observerStreamError', {
                                      participantIdentity: participantId,
                                      error: `Failed to parse observer message: ${parseError}`
                                  });
                              }
                          }
                      } else {
                          console.log(`[Animus SDK] Unexpected additional message from observer - ignoring`);
                      }
                  }

              } catch (error) {
                  console.error(`[Animus SDK] Error processing observer message: ${error}`);
                  this.emit('observerStreamError', {
                      participantIdentity: participantId,
                      error: error instanceof Error ? error.message : String(error)
                  });
              }
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
  
  /**
   * Forces the current observer configuration to be sent to the backend.
   * This can be useful after changing settings to ensure the backend is updated immediately.
   * @returns Promise that resolves when config is sent, or rejects if there's an error
   */
  public async syncObserverConfig(): Promise<void> {
    if (!this.observerEnabled) {
      throw new Error("Observer is not enabled in configuration.");
    }
    
    if (!this.isObserverConnected()) {
      throw new Error("Observer is not connected. Connect first using connectObserverManually().");
    }
    
    console.log('[Animus SDK] Manually syncing observer configuration with backend');
    return this.sendObserverConfigUpdate({});
  }


  /**
   * This method is simplified to just notify the Chat module that there was user activity
   * We no longer schedule checks based on inactivity - instead we only send to observer
   * after receiving an assistant response.
   */
  public resetUserActivity(): void {
    // This method is kept for backward compatibility
    // The actual sending to observer happens in Chat.ts when an assistant response is received
    console.log('[Animus SDK] User activity registered (no scheduling needed)');
  }
  
  /**
   * Sends the current message history to the observer for analysis.
   * This formats the messages according to the observer API requirements.
   */
  private async sendMessageHistoryToObserver(): Promise<void> {
    if (!this.observerEnabled || !this.isObserverConnected()) {
      console.log('[Animus SDK] Cannot send message history: Observer not connected');
      return;
    }
    
    if (!this.chat) {
      console.warn('[Animus SDK] Chat module not available, cannot send history to observer.');
      return;
    }
    
    // Get chat history from the chat module
    const chatHistory = this.chat.getChatHistory();
    const systemMessage = this.options.chat?.systemMessage;
    
    if (!chatHistory || chatHistory.length === 0) {
      console.log('[Animus SDK] No chat history to send to observer.');
      return;
    }
    
    try {
      // Format messages for the observer including timestamps
      const messagesWithTimestamps = chatHistory.map(msg => {
        // Check if message already has a timestamp format
        const hasTimestamp = typeof msg.content === 'string' && msg.content.match(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        
        return {
          role: msg.role,
          // Add timestamp if not present, or keep as is if already formatted
          content: hasTimestamp ? msg.content : `[${msg.timestamp || new Date().toISOString()}]: ${msg.content}`,
          ...(msg.name && { name: msg.name })
        };
      });
      
      // Prepare the payload for the observer
      const observerPayload = {
        messages: systemMessage ?
          [{ role: 'system', content: systemMessage }, ...messagesWithTimestamps] :
          messagesWithTimestamps
      };
      
      // Send to observer
      await this.sendObserverText(JSON.stringify(observerPayload));
      
      console.log(`[Animus SDK] Sent message history to observer with ${messagesWithTimestamps.length} messages`);
    } catch (error) {
      console.error('[Animus SDK] Error sending message history to observer:', error);
      throw error; // Rethrow to allow handling in calling functions
    }
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
   * Updates observer configuration parameters and sends them to the backend agent
   * @param config Configuration parameters to update
   */
  public updateObserverConfig(config: Partial<AnimusObserverOptions>): void {
    // Track if any changes were actually made
    let configChanged = false;
    
    // Only update configuration fields that are present
    // Iterate over known, new config keys to update them
    const knownConfigKeys: (keyof Omit<AnimusObserverOptions, 'enabled'>)[] = [
        'initial_inactivity_delay',
        'backoff_multiplier',
        'max_inactivity_messages'
    ];

    knownConfigKeys.forEach(key => {
        if (config[key] !== undefined && this.observerConfig[key] !== config[key]) {
            const oldValue = this.observerConfig[key];
            this.observerConfig[key] = config[key] as any; // Type assertion
            configChanged = true;
            console.log(`[Animus SDK] Observer config changed: ${key} = ${config[key]} (was ${oldValue})`);
        }
    });

    // Handle any other custom keys if necessary, though direct use of defined keys is preferred
    Object.keys(config).forEach(key => {
        if (!knownConfigKeys.includes(key as any) && key !== 'enabled' && config[key] !== undefined) {
            const oldValue = (this.observerConfig as any)[key];
            const newValue = config[key];
            if (oldValue !== newValue) {
                (this.observerConfig as any)[key] = newValue;
                configChanged = true;
                console.log(`[Animus SDK] Observer custom config changed: ${key} = ${newValue} (was ${oldValue})`);
            }
        }
    });
    
    if (!configChanged) {
      console.log('[Animus SDK] No observer configuration changes detected.');
      return;
    }
    
    console.log('[Animus SDK] Observer configuration updated:', this.observerConfig);
    
    // If observer is connected, immediately send the FULL config
    if (this.observerEnabled && this.isObserverConnected()) {
      console.log('[Animus SDK] Sending updated observer configuration to backend');
      this.sendObserverConfigUpdate(config)
        .then(() => console.log('[Animus SDK] Observer configuration successfully sent to backend'))
        .catch(error => {
          console.error('[Animus SDK] Failed to send observer config update:', error);
        });
    }
  }
  
  /**
   * Sends configuration updates to the observer
   * Always sends the full current configuration to ensure observer has the latest values
   */
  private async sendObserverConfigUpdate(config: Partial<AnimusObserverOptions>): Promise<void> {
    // Create a payload with the FULL current configuration, not just the changed parts
    const payload = {
      observer_config: {
        // Send only the new, supported configuration parameters
        initial_inactivity_delay: this.observerConfig.initial_inactivity_delay,
        backoff_multiplier: this.observerConfig.backoff_multiplier,
        max_inactivity_messages: this.observerConfig.max_inactivity_messages
        // Any other custom keys present in this.observerConfig will also be sent if the backend supports them
        // However, explicitly list the known ones for clarity and adherence to the new spec.
      }
    };
    // Add any other custom keys that might have been set on observerConfig
    Object.keys(this.observerConfig).forEach(key => {
        if (!['initial_inactivity_delay', 'backoff_multiplier', 'max_inactivity_messages'].includes(key)) {
            if ((payload.observer_config as any)[key] === undefined) { // Avoid overwriting already set known keys
                 (payload.observer_config as any)[key] = (this.observerConfig as any)[key];
            }
        }
    });
    
    console.log('[Animus SDK] Sending full observer configuration to backend:', payload);
    await this.sendObserverText(JSON.stringify(payload));
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
                  `<img src='${imageUrl}' description='${prompt}' />`,
                  null, // No compliance violations
                  false // Not from observer
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