import { ConversationalTurnsConfig, QueuedMessage, MessageCallback, EventEmitter } from './types';
import { ConversationalTurnsConfigValidator } from './config';
import { ResponseSplitter } from './ResponseSplitter';
import { MessageQueue } from './MessageQueue';
import { ToolCall } from '../Chat';

/**
 * Main orchestrator for the conversational turns feature
 * Manages splitting, queuing, and event emission
 */
export class ConversationalTurnsManager {
  private splitter?: ResponseSplitter;
  private messageQueue?: MessageQueue;
  private config?: ConversationalTurnsConfig;
  private onMessageCallback?: MessageCallback;
  private conversationId: string;
  
  constructor(
    config?: ConversationalTurnsConfig,
    onMessageCallback?: MessageCallback,
    eventEmitter?: EventEmitter
  ) {
    this.conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.updateConfig(config, onMessageCallback, eventEmitter);
  }
  
  /**
   * Update configuration and reinitialize components
   * @param config New configuration to apply
   * @param onMessageCallback Callback for processing messages
   * @param eventEmitter Event emitter for turn events
   */
  public updateConfig(
    config?: ConversationalTurnsConfig,
    onMessageCallback?: MessageCallback,
    eventEmitter?: EventEmitter
  ): void {
    this.config = config;
    this.onMessageCallback = onMessageCallback;
    
    // Validate configuration
    ConversationalTurnsConfigValidator.validate(config);
    
    // Clear existing queue if configuration changes
    if (this.messageQueue) {
      this.messageQueue.clear();
    }
    
    // Initialize components if feature is enabled
    if (config?.enabled && onMessageCallback) {
      this.splitter = new ResponseSplitter(config);
      
      // Create a callback that adds messages to history with group metadata
      const groupAwareCallback = (content: string | null, violations?: string[], toolCalls?: any[], groupMetadata?: any) => {
        console.log('[ConversationalTurns] Adding split message to history with group metadata:', groupMetadata);
        if (onMessageCallback) {
          onMessageCallback(content, violations, toolCalls, groupMetadata);
        }
      };
      
      this.messageQueue = new MessageQueue(groupAwareCallback, eventEmitter, this.conversationId);
    } else {
      this.splitter = undefined;
      this.messageQueue = undefined;
    }
  }
  
  /**
   * Process a response - either split it or return false for normal processing
   * @param content The response content to potentially split
   * @param complianceViolations Any compliance violations from the response
   * @param toolCalls Any tool calls from the response
   * @param apiTurns Pre-split turns from the API (if autoTurn was enabled)
   * @returns True if the response was split and queued, false if normal processing should continue
   */
  public processResponse(
    content: string | null,
    complianceViolations?: string[],
    toolCalls?: ToolCall[],
    apiTurns?: string[]
  ): boolean {
    // Return false if feature is disabled or no content
    if (!this.messageQueue || !content) {
      console.log('[ConversationalTurns] Not processing - disabled or no content:', {
        hasQueue: !!this.messageQueue,
        hasContent: !!content
      });
      return false;
    }
    
    let splitMessages: { content: string; delay: number; turnIndex: number; totalTurns: number }[];
    
    // Check if we should use splitting based on splitProbability
    const shouldSplit = Math.random() < (this.config?.splitProbability ?? 1.0);
    console.log('[ConversationalTurns] Split probability check:', shouldSplit, 'probability:', this.config?.splitProbability);
    
    if (!shouldSplit) {
      console.log('[ConversationalTurns] Skipping split due to probability - using original content');
      return false; // Use original content instead of splits
    }
    
    // If API provided pre-split turns, use those
    if (apiTurns && apiTurns.length > 1) {
      console.log('[ConversationalTurns] Using API-provided turns:', apiTurns.length, 'turns');
      splitMessages = apiTurns.map((turn, index) => ({
        content: turn,
        delay: index === 0 ? 0 : this.calculateDelayForTurn(turn),
        turnIndex: index,
        totalTurns: apiTurns.length
      }));
    } else if (this.splitter) {
      // Fall back to client-side splitting if no API turns provided
      console.log('[ConversationalTurns] Using client-side splitting for:', content);
      splitMessages = this.splitter.splitResponse(content);
      console.log('[ConversationalTurns] Split result:', splitMessages.length, 'messages');
    } else {
      // No splitter and no API turns - return false for normal processing
      console.log('[ConversationalTurns] No splitting method available');
      return false;
    }
    
    // If not split, return false to indicate normal processing should continue
    if (splitMessages.length <= 1) {
      console.log('[ConversationalTurns] Not splitting - only', splitMessages.length, 'message(s)');
      return false;
    }
    
    // Generate a unique group ID for this set of split messages
    const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log('[ConversationalTurns] Creating message group:', groupId, 'with', splitMessages.length, 'messages');
    
    // Convert to queued messages with group metadata
    // Don't set timestamp here - it will be set when the message is actually processed
    const queuedMessages: QueuedMessage[] = splitMessages.map((msg, index) => ({
      content: msg.content,
      delay: msg.delay,
      timestamp: 0, // Placeholder - will be set when processed
      turnIndex: msg.turnIndex,
      totalTurns: msg.totalTurns,
      // Add group metadata
      groupId: groupId,
      messageIndex: index,
      totalInGroup: splitMessages.length,
      // Only add violations and tool calls to the last message in the group
      compliance_violations: index === splitMessages.length - 1 ? complianceViolations : undefined,
      tool_calls: index === splitMessages.length - 1 ? toolCalls : undefined
    }));
    
    // Enqueue the messages - they will be added to history with group metadata
    console.log('[ConversationalTurns] Enqueueing', queuedMessages.length, 'messages with delays:',
                queuedMessages.map(m => m.delay).join(', '));
    this.messageQueue.enqueue(queuedMessages);
    
    return true; // Indicate that splitting was applied
  }
  
  /**
   * Calculate delay for a turn using the same logic as the splitter
   * @param content The turn content to calculate delay for
   * @returns Delay in milliseconds
   */
  private calculateDelayForTurn(content: string): number {
    if (!this.config) return 1500; // Default delay if no config
    
    // Use the same delay calculation logic as the splitter
    const baseTypingSpeed = this.config.baseTypingSpeed ?? 45;
    const speedVariation = this.config.speedVariation ?? 0.2;
    const minDelay = this.config.minDelay ?? 800;
    const maxDelay = this.config.maxDelay ?? 4000;
    
    // Calculate delay based on content length and typing speed
    const words = content.split(/\s+/).length;
    const baseDelay = (words / baseTypingSpeed) * 60 * 1000; // Convert to milliseconds
    
    // Apply speed variation
    const variation = 1 + (Math.random() - 0.5) * 2 * speedVariation;
    const adjustedDelay = baseDelay * variation;
    
    // Clamp to min/max bounds
    return Math.max(minDelay, Math.min(maxDelay, adjustedDelay));
  }
  
  /**
   * Cancel any pending messages (called when user sends new message)
   * @returns Number of messages that were canceled
   */
  public cancelPendingMessages(): number {
    if (!this.messageQueue) return 0;
    return this.messageQueue.cancelRemaining();
  }
  
  /**
   * Clear all messages and reset state
   */
  public clear(): void {
    if (this.messageQueue) {
      this.messageQueue.clear();
    }
  }
  
  /**
   * Get current status for debugging and monitoring
   * @returns Object with enabled state and queue status
   */
  public getStatus(): {
    enabled: boolean;
    queueStatus?: { queueLength: number; isProcessing: boolean; processedCount: number };
  } {
    return {
      enabled: this.config?.enabled ?? false,
      queueStatus: this.messageQueue?.getStatus()
    };
  }
  
  /**
   * Check if feature is enabled
   * @returns True if conversational turns are enabled
   */
  public isEnabled(): boolean {
    return this.config?.enabled ?? false;
  }
  
  /**
   * Check if the queue is currently active (processing or has pending messages)
   * @returns True if queue is active
   */
  public isActive(): boolean {
    return this.messageQueue?.isActive() ?? false;
  }
  
  /**
   * Get current configuration
   * @returns Current configuration object or undefined if not set
   */
  public getConfig(): ConversationalTurnsConfig | undefined {
    return this.config;
  }
  
  /**
   * Update just the splitter configuration without reinitializing everything
   * @param config New configuration to apply to the splitter
   */
  public updateSplitterConfig(config: ConversationalTurnsConfig): void {
    if (this.splitter) {
      this.splitter.updateConfig(config);
    }
    this.config = config;
  }
}