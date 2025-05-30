import type { ToolCall } from '../chat/types';

/**
 * Configuration interface for conversational turns feature
 */
export interface ConversationalTurnsConfig {
  /** Enable/disable the feature. Default: false */
  enabled: boolean;
  
  
  /** Base typing speed in WPM for delay calculation. Default: 45 */
  baseTypingSpeed?: number;
  
  /** Speed variation factor (±percentage). Default: 0.2 (±20%) */
  speedVariation?: number;
  
  /** Minimum delay between messages in milliseconds. Default: 800 */
  minDelay?: number;
  
  /** Maximum delay between messages in milliseconds. Default: 4000 */
  maxDelay?: number;
  
  /** Maximum number of turns allowed (including next flag). Default: 3 */
  maxTurns?: number;
  
  /** Delay in milliseconds before sending follow-up requests. Default: 2000 */
  followUpDelay?: number;
  
  /** Maximum number of sequential follow-up requests allowed before requiring user input. Default: 2 */
  maxSequentialFollowUps?: number;
}

/**
 * Simple boolean configuration for auto-turn feature
 */
export interface AutoTurnConfig {
  /** Enable/disable the auto-turn feature. Default: false */
  enabled: boolean;
}

/**
 * Represents a split message with its delay and position info
 */
export interface SplitMessage {
  content: string;
  delay: number;
  turnIndex: number;
  totalTurns: number;
}

/**
 * Represents a queued message with all necessary metadata
 */
export interface QueuedMessage {
  content: string;
  delay: number;
  timestamp: number;
  compliance_violations?: string[];
  tool_calls?: ToolCall[];
  turnIndex: number;
  totalTurns: number;
  // Group metadata for reassembly
  groupId?: string;
  messageIndex?: number;
  totalInGroup?: number;
  groupTimestamp?: number; // Original timestamp when the group was created
  // Image generation metadata
  messageType?: 'text' | 'image';
  imagePrompt?: string;
  hasNext?: boolean;
}

/**
 * Event data for unified message events
 */
export interface MessageEventData {
  conversationId: string;
  messageType: 'regular' | 'auto' | 'followup';
  content: string;
  turnIndex?: number;
  totalTurns?: number;
  compliance_violations?: string[];
  tool_calls?: ToolCall[];
}

/**
 * Event data for message completion (when all related messages are done)
 */
export interface MessageCompleteData {
  conversationId: string;
  totalMessages: number;
  totalTurns?: number;
}

/**
 * Event data for message errors
 */
export interface MessageErrorData {
  conversationId: string;
  messageType: 'regular' | 'auto' | 'followup';
  error: string;
  turnIndex?: number;
  totalTurns?: number;
}

/**
 * Group metadata for message reassembly
 */
export interface GroupMetadata {
  groupId?: string;
  messageIndex?: number;
  totalInGroup?: number;
  processedTimestamp?: number; // Timestamp when the message was actually processed (for proper ordering)
  groupTimestamp?: number; // Original timestamp when the group was created (for reconstruction ordering)
}

/**
 * Callback type for processing messages
 */
export type MessageCallback = (
  content: string | null,
  violations?: string[],
  toolCalls?: ToolCall[],
  groupMetadata?: GroupMetadata,
  messageType?: 'text' | 'image',
  imagePrompt?: string,
  hasNext?: boolean
) => void;

/**
 * Event emitter callback type
 */
export type EventEmitter = (
  event: string,
  data: MessageEventData | MessageErrorData | MessageCompleteData
) => void;