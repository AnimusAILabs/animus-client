// Main SDK Client and Client Module
export { AnimusClient } from './client';
export type {
  AnimusClientOptions,
  AnimusClientEventMap,
  AnimusChatOptions,
  AnimusVisionOptions
} from './client';

// Export client components for advanced usage
export { ConfigurationManager, ClientEventManager, ImageGenerator } from './client';

// Authentication and API Error Types
export { AuthenticationError } from './AuthHandler';
export { ApiError } from './RequestUtil';

// Chat Module - Export everything from chat module
export type {
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  Tool,
  ToolCall
} from './chat/types';

// Export chat components for advanced usage
export { ChatModule } from './Chat';
export { ChatHistory } from './chat/ChatHistory';
export { StreamingHandler } from './chat/StreamingHandler';
export { FollowUpHandler } from './chat/FollowUpHandler';
export { ChatRequestBuilder } from './chat/ChatRequestBuilder';

// Conversational Turns Types
export type {
  ConversationalTurnsConfig,
  SplitMessage,
  QueuedMessage,
  MessageEventData,
  MessageCompleteData,
  MessageErrorData,
  GroupMetadata,
  MessageCallback,
  EventEmitter
} from './conversational-turns';

export {
  ConversationalTurnsManager,
  ResponseSplitter,
  MessageQueue,
  ConversationalTurnsConfigValidator,
  DEFAULT_CONVERSATIONAL_TURNS_CONFIG,
  SentenceExtractor,
  DelayCalculator
} from './conversational-turns';

// Media Module Types
export type {
  MediaMessage,
  MediaCompletionRequest,
  MediaCompletionResponse,
  MediaAnalysisRequest,
  MediaAnalysisResultResponse,
  MediaAnalysisStatusResponse
} from './Media';

// Re-export ConnectionState from livekit-client for easier consumption
export { ConnectionState } from 'livekit-client';