import type { RequestUtil } from '../RequestUtil';
import { ApiError } from '../RequestUtil';
import type { ChatModule } from '../Chat';
import type { ClientEventManager } from './ClientEventManager';

/**
 * Handles image generation functionality for the AnimusClient
 */
export class ImageGenerator {
    private requestUtil: RequestUtil;
    private chatModule?: ChatModule;
    private eventManager: ClientEventManager;

    constructor(requestUtil: RequestUtil, eventManager: ClientEventManager) {
        this.requestUtil = requestUtil;
        this.eventManager = eventManager;
    }

    /**
     * Sets the chat module reference for adding images to chat history
     */
    public setChatModule(chatModule: ChatModule): void {
        this.chatModule = chatModule;
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
            // Emit image generation start event
            this.eventManager.emitImageGenerationStart({ prompt });

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
                console.error('Invalid image generation response format:', response);
                const error = new Error('No image URL found in server response');
                this.eventManager.emitImageGenerationError({ prompt, error });
                throw error;
            }

            // If the chat module is available, add the image to chat history
            if (this.chatModule) {
                // Add image message as an assistant response to history
                this.chatModule.addAssistantResponseToHistory(
                    `<image description='${prompt}' />`,
                    null, // No compliance violations
                    undefined, // No tool calls
                    undefined, // No group metadata
                    null // No reasoning
                );
            }

            // Emit image generation complete event
            this.eventManager.emitImageGenerationComplete({ prompt, imageUrl });
            
            return imageUrl;
        } catch (error) {
            console.error('Error generating image:', error);
            
            // Emit image generation error event
            this.eventManager.emitImageGenerationError({ prompt, error: error instanceof Error ? error : String(error) });
            
            // Re-throw the error with proper typing
            throw error instanceof ApiError
                ? error
                : new ApiError(`Failed to generate image: ${error instanceof Error ? error.message : String(error)}`, 0, error);
        }
    }

    /**
     * Modifies an existing image based on the provided prompt.
     * Returns the URL of the modified image and adds it to chat history.
     *
     * @param prompt - The text prompt describing how to modify the image
     * @param inputImageUrl - The URL of the input image to modify
     * @returns A Promise resolving to the URL of the modified image
     * @throws {ApiError} If the image modification fails
     */
    public async modifyImage(prompt: string, inputImageUrl: string): Promise<string> {
        if (!prompt || prompt.trim() === '') {
            throw new Error('Image modification requires a non-empty prompt');
        }

        if (!inputImageUrl || inputImageUrl.trim() === '') {
            throw new Error('Image modification requires a valid input image URL');
        }

        try {
            // Emit image generation start event
            this.eventManager.emitImageGenerationStart({ prompt });

            // Make the request to modify the image
            const response = await this.requestUtil.request(
                'POST',
                '/generate/image',
                {
                    prompt: prompt,
                    input_image: inputImageUrl
                },
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
                console.error('Invalid image modification response format:', response);
                const error = new Error('No image URL found in server response');
                this.eventManager.emitImageGenerationError({ prompt, error });
                throw error;
            }

            // If the chat module is available, add the modified image to chat history
            if (this.chatModule) {
                // Add image message as an assistant response to history
                this.chatModule.addAssistantResponseToHistory(
                    `<image description='Modified: ${prompt}' />`,
                    null, // No compliance violations
                    undefined, // No tool calls
                    undefined, // No group metadata
                    null // No reasoning
                );
            }

            // Emit image generation complete event
            this.eventManager.emitImageGenerationComplete({ prompt, imageUrl });
            
            return imageUrl;
        } catch (error) {
            console.error('Error modifying image:', error);
            
            // Emit image modification error event
            this.eventManager.emitImageGenerationError({
                prompt,
                error: error instanceof Error ? error : String(error)
            });
            
            // Re-throw the error with proper typing
            throw error instanceof ApiError
                ? error
                : new ApiError(`Failed to modify image: ${error instanceof Error ? error.message : String(error)}`, 0, error);
        }
    }

    /**
     * Generates or modifies an image based on the provided parameters.
     * This is a unified method that automatically chooses between text-to-image generation
     * and image modification based on whether an input image URL is provided.
     *
     * @param prompt - The text prompt for generation or modification
     * @param inputImageUrl - Optional URL of the input image to modify
     * @returns A Promise resolving to the URL of the generated or modified image
     * @throws {ApiError} If the operation fails
     */
    public async processImage(prompt: string, inputImageUrl?: string): Promise<string> {
        if (inputImageUrl && inputImageUrl.trim() !== '') {
            return this.modifyImage(prompt, inputImageUrl);
        } else {
            return this.generateImage(prompt);
        }
    }
}