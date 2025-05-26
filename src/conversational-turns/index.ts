// Main exports for the conversational turns feature
export { ConversationalTurnsManager } from './ConversationalTurnsManager';
export { ResponseSplitter } from './ResponseSplitter';
export { MessageQueue } from './MessageQueue';
export { ConversationalTurnsConfigValidator, DEFAULT_CONVERSATIONAL_TURNS_CONFIG } from './config';
export { SentenceExtractor, DelayCalculator } from './utils';

// Export all types
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
} from './types';