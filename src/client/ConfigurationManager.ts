import type { AnimusChatOptions, AnimusVisionOptions, AnimusClientOptions } from './types';
import type { ChatModule } from '../Chat';

/**
 * Manages configuration for the AnimusClient, including validation and updates
 */
export class ConfigurationManager {
    private options: Omit<Required<AnimusClientOptions>, 'chat' | 'vision'> & {
        chat?: AnimusChatOptions;
        vision?: AnimusVisionOptions;
    };

    constructor(options: AnimusClientOptions) {
        this.options = {} as any; // Initialize to avoid TS error
        this.validateAndSetOptions(options);
    }

    /**
     * Validates and sets the initial configuration options
     */
    private validateAndSetOptions(options: AnimusClientOptions): void {
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
    }

    /**
     * Gets the current configuration options
     */
    public getOptions(): Omit<Required<AnimusClientOptions>, 'chat' | 'vision'> & {
        chat?: AnimusChatOptions;
        vision?: AnimusVisionOptions;
    } {
        return this.options;
    }

    /**
     * Updates the chat configuration that will be used for future requests.
     * This allows dynamically changing system message, temperature, etc. without recreating the client.
     * @param config New chat configuration options
     * @param chatModule The chat module to update with the new configuration
     */
    public updateChatConfig(config: Partial<AnimusChatOptions>, chatModule?: ChatModule): void {
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
        if (chatModule && this.options.chat) {
            chatModule.updateConfig(this.options.chat);
        }
    }

    /**
     * Updates compliance configuration parameters
     * @param config New compliance configuration
     * @param chatModule The chat module to update with the new configuration
     */
    public updateComplianceConfig(config: { enabled: boolean }, chatModule?: ChatModule): void {
        // Skip if no config provided
        if (!config) return;

        // If chat options don't exist yet, create them
        if (!this.options.chat) {
            throw new Error('Cannot update compliance config: chat options not initialized');
        }

        // Update the compliance setting
        this.options.chat.compliance = config.enabled;
        
        // Update the chat module with new config
        if (chatModule && this.options.chat) {
            chatModule.updateConfig(this.options.chat);
        }
    }

    /**
     * Gets the current chat configuration
     */
    public getChatConfig(): AnimusChatOptions | undefined {
        return this.options.chat;
    }

    /**
     * Gets the current vision configuration
     */
    public getVisionConfig(): AnimusVisionOptions | undefined {
        return this.options.vision;
    }

    /**
     * Gets the token provider URL
     */
    public getTokenProviderUrl(): string {
        return this.options.tokenProviderUrl;
    }

    /**
     * Gets the API base URL
     */
    public getApiBaseUrl(): string {
        return this.options.apiBaseUrl;
    }

    /**
     * Gets the token storage setting
     */
    public getTokenStorage(): 'localStorage' | 'sessionStorage' {
        return this.options.tokenStorage;
    }
}