import { EventEmitter } from 'eventemitter3';
import type { AnimusClientEventMap } from './types';

/**
 * Manages event emission and coordination for the AnimusClient
 */
export class ClientEventManager extends EventEmitter<AnimusClientEventMap> {
    constructor() {
        super();
    }

    /**
     * Creates an event emitter function that can be passed to modules
     * This allows modules to emit events through the main client
     */
    public createEventEmitter(): (event: string, data: any) => void {
        return (event: string, data: any) => {
            this.emit(event as keyof AnimusClientEventMap, data);
        };
    }

    /**
     * Emits a conversational turn start event
     */
    public emitConversationalTurnStart(data: { content: string; turnIndex: number; totalTurns: number }): void {
        this.emit('conversationalTurnStart', data);
    }

    /**
     * Emits a conversational turn complete event
     */
    public emitConversationalTurnComplete(data: { content: string; turnIndex: number; totalTurns: number }): void {
        this.emit('conversationalTurnComplete', data);
    }

    /**
     * Emits a conversational turns canceled event
     */
    public emitConversationalTurnsCanceled(data: { canceledTurns: number }): void {
        this.emit('conversationalTurnsCanceled', data);
    }

    /**
     * Emits a conversational turns complete event
     */
    public emitConversationalTurnsComplete(): void {
        this.emit('conversationalTurnsComplete');
    }

    /**
     * Emits a message start event
     */
    public emitMessageStart(data: {
        conversationId: string;
        messageType: 'regular' | 'auto' | 'followup';
        content: string;
        turnIndex?: number;
        totalTurns?: number;
    }): void {
        this.emit('messageStart', data);
    }

    /**
     * Emits a message tokens event
     */
    public emitMessageTokens(data: { content: string }): void {
        this.emit('messageTokens', data);
    }

    /**
     * Emits a message progress event
     */
    public emitMessageProgress(data: { content: string; isComplete: boolean }): void {
        this.emit('messageProgress', data);
    }

    /**
     * Emits a message complete event
     */
    public emitMessageComplete(data: {
        conversationId: string;
        messageType?: 'regular' | 'auto' | 'followup';
        content: string;
        reasoning?: string;
        toolCalls?: import('../chat/types').ToolCall[];
        imagePrompt?: string;
        turnIndex?: number;
        totalTurns?: number;
        totalMessages?: number;
    }): void {
        this.emit('messageComplete', data);
    }

    /**
     * Emits a message error event
     */
    public emitMessageError(data: {
        conversationId: string;
        messageType?: 'regular' | 'auto' | 'followup';
        error: Error | string;
        turnIndex?: number;
        totalTurns?: number;
    }): void {
        this.emit('messageError', data);
    }

    /**
     * Emits an image generation start event
     */
    public emitImageGenerationStart(data: { prompt: string }): void {
        this.emit('imageGenerationStart', data);
    }

    /**
     * Emits an image generation complete event
     */
    public emitImageGenerationComplete(data: { prompt: string; imageUrl: string }): void {
        this.emit('imageGenerationComplete', data);
    }

    /**
     * Emits an image generation error event
     */
    public emitImageGenerationError(data: { prompt: string; error: Error | string }): void {
        this.emit('imageGenerationError', data);
    }
}