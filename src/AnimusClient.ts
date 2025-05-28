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
import { ChatModule } from './Chat';
import type { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk, Tool, ChatMessage, ToolCall } from './chat/types';
import { MediaModule, MediaCompletionRequest, MediaCompletionResponse, MediaAnalysisRequest, MediaAnalysisResultResponse, MediaAnalysisStatusResponse } from './Media';

// Import new modular components
import { ConfigurationManager } from './client/ConfigurationManager';
import { ClientEventManager } from './client/ClientEventManager';
import { ImageGenerator } from './client/ImageGenerator';
import type { 
    AnimusChatOptions, 
    AnimusVisionOptions, 
    AnimusClientOptions, 
    AnimusClientEventMap 
} from './client/types';

// Re-export error types for convenience
export { AuthenticationError, ApiError };

// Re-export types from client module
export type {
    AnimusChatOptions,
    AnimusVisionOptions,
    AnimusClientOptions,
    AnimusClientEventMap
} from './client/types';

/**
* Animus Javascript SDK Client for browser environments.
* Emits events for Observer connection status and incoming streams.
*/
export class AnimusClient extends ClientEventManager {
    // Internal modules
    private authHandler: AuthHandler;
    private requestUtil: RequestUtil;
    private configManager: ConfigurationManager;
    private imageGenerator: ImageGenerator;

    /** Access Chat API methods. */
    public readonly chat: ChatModule;
    /** Access Media (Vision) API methods. */
    public readonly media: MediaModule;

    /**
     * Creates an instance of the AnimusClient.
     * @param options - Configuration options for the SDK.
     */
    constructor(options: AnimusClientOptions) {
        super(); // Initialize ClientEventManager (which extends EventEmitter)

        // Initialize configuration manager with validation
        this.configManager = new ConfigurationManager(options);

        // Initialize internal modules
        this.authHandler = new AuthHandler(
            this.configManager.getTokenProviderUrl(), 
            this.configManager.getTokenStorage()
        );
        this.requestUtil = new RequestUtil(
            this.configManager.getApiBaseUrl(), 
            this.authHandler
        );

        // Initialize image generator
        this.imageGenerator = new ImageGenerator(this.requestUtil, this);

        // Pass relevant config to modules
        this.chat = new ChatModule(
            this.requestUtil,
            this.configManager.getChatConfig(),
            // Pass generateImage method to standardize image generation
            this.generateImage.bind(this),
            // Pass event emitter for conversational turn events
            this.createEventEmitter()
        );
        this.media = new MediaModule(
            this.requestUtil,
            this.configManager.getVisionConfig()
        );

        // Set chat module reference in image generator for history management
        this.imageGenerator.setChatModule(this.chat);
    }

    /**
     * Clears any stored authentication token.
     */
    public clearAuthToken(): void {
        this.authHandler.clearAllDetails();
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
        this.configManager.updateChatConfig(config, this.chat);
    }

    /**
     * Updates compliance configuration parameters
     * @param config New compliance configuration
     */
    public updateComplianceConfig(config: { enabled: boolean }): void {
        this.configManager.updateComplianceConfig(config, this.chat);
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
        return this.imageGenerator.generateImage(prompt);
    }
}

// Re-export types from their respective modules
export type {
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk
} from './chat/types';
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