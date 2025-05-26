// Type definitions for animus-client
// Project: https://github.com/AnimusAILabs/animus-client

import { AnimusClient, AnimusClientOptions, AnimusClientEventMap } from './AnimusClient';
import { AuthenticationError, ApiError } from './AnimusClient';
import {
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk
} from './Chat';
import {
  MediaMessage,
  MediaCompletionRequest,
  MediaCompletionResponse,
  MediaAnalysisRequest,
  MediaAnalysisResultResponse,
  MediaAnalysisStatusResponse
} from './Media';
import { ConnectionState } from 'livekit-client';

// Re-export all types for external use
export {
  AnimusClient,
  AnimusClientOptions,
  AnimusClientEventMap,
  AuthenticationError,
  ApiError,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  MediaMessage,
  MediaCompletionRequest,
  MediaCompletionResponse,
  MediaAnalysisRequest,
  MediaAnalysisResultResponse,
  MediaAnalysisStatusResponse,
  ConnectionState
};

// Export Observer-specific interfaces for event handlers
export interface ObserverChunkData {
  participantIdentity: string;
  /** The raw chunk object received from the Observer. */
  chunk: ChatCompletionChunk;
  /** Content delta from the chunk, if any. */
  deltaContent?: string;
  /** Compliance violations associated with this stream (consistent across chunks). */
  compliance_violations?: string[] | null;
}

export interface ObserverCompleteData {
  participantIdentity: string;
  /** Final content of the message from the Observer. */
  fullContent: string;
  /** Final usage statistics, if available from the Observer message. */
  usage?: ChatCompletionResponse['usage'] | null;
  /** Final compliance violations status for the Observer message. */
  compliance_violations?: string[] | null;
  /** The original message content before processing */
  rawContent?: string;
}

export interface ObserverErrorData {
  participantIdentity: string;
  /** The error message related to the Observer stream. */
  error: string;
}

export interface ObserverSessionEndedData {
  participantIdentity: string;
  reason: 'max_messages_reached' | 'session_ended';
}

// Add TypeScript ambient module declaration for UMD build
declare global {
  interface Window {
    AnimusSDK: {
      AnimusClient: typeof AnimusClient;
      AuthenticationError: typeof AuthenticationError;
      ApiError: typeof ApiError;
    };
  }
}