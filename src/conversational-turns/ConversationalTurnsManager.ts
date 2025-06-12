import { ConversationalTurnsConfig, QueuedMessage, MessageCallback, EventEmitter } from './types';
import { ConversationalTurnsConfigValidator } from './config';
import { MessageQueue } from './MessageQueue';
import type { ToolCall } from '../chat/types';

/**
 * Main orchestrator for the conversational turns feature
 * Manages splitting, queuing, and event emission
 */
export class ConversationalTurnsManager {
  private messageQueue?: MessageQueue;
  private config?: ConversationalTurnsConfig;
  private onMessageCallback?: MessageCallback;
  private conversationId: string;
  private canceledMessageIds: Set<string> = new Set();
  
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
      // Create a callback that adds messages to history with group metadata
      const groupAwareCallback = (
        content: string | null,
        violations?: string[],
        toolCalls?: any[],
        groupMetadata?: any,
        messageType?: 'text' | 'image',
        imagePrompt?: string,
        hasNext?: boolean,
        reasoning?: string | null
      ) => {
        // Check if this specific message was canceled
        const messageId = `${groupMetadata?.groupId}_${groupMetadata?.messageIndex}`;
        if (messageId && this.canceledMessageIds.has(messageId)) {
          // Skip processing canceled messages - don't add them to history
          return;
        }
        
        if (onMessageCallback) {
          onMessageCallback(content, violations, toolCalls, groupMetadata, messageType, imagePrompt, hasNext, reasoning);
        }
      };
      
      this.messageQueue = new MessageQueue(groupAwareCallback, eventEmitter, this.conversationId);
    } else {
      this.messageQueue = undefined;
    }
  }
  
  /**
   * Process a response - either split it or return false for normal processing
   * @param content The response content to potentially split
   * @param complianceViolations Any compliance violations from the response
   * @param toolCalls Any tool calls from the response
   * @param apiTurns Pre-split turns from the API (if autoTurn was enabled)
   * @param imagePrompt Image prompt for generation (optional)
   * @param hasNext Whether there's a follow-up request (optional)
   * @returns True if the response was split and queued, false if normal processing should continue
   */
  public processResponse(
    content: string | null,
    complianceViolations?: string[],
    toolCalls?: ToolCall[],
    apiTurns?: string[],
    imagePrompt?: string,
    hasNext?: boolean,
    reasoning?: string | null
  ): boolean {
    // Debug logging
    console.log('ConversationalTurnsManager.processResponse called with:', {
      content: content?.substring(0, 50) + '...',
      hasApiTurns: !!apiTurns,
      apiTurnsLength: apiTurns?.length,
      reasoning: reasoning?.substring(0, 50) + '...'
    });
    
    // Return false if feature is disabled or no content
    if (!this.messageQueue || !content) {
      return false;
    }
    
    let splitMessages: { content: string; delay: number; turnIndex: number; totalTurns: number }[];
    
    // Priority 1: If autoTurn is true AND content has newlines → ALWAYS force splitting on newlines
    // (ignore probability, ignore pre-split turns)
    if (content.includes('\n') && apiTurns !== undefined) {
      const lines = content.split('\n').filter(line => line.trim().length > 0);
      
      // If we have newlines in the original content but only 1 line after filtering,
      // still process it as a single turn (the presence of newlines indicates intent to split)
      if (lines.length === 0) {
        return false; // No content to process
      }
      
      // Apply turn limiting with concatenation to newline-split content
      splitMessages = this.applyTurnLimiting(lines, hasNext);
    }
    // Priority 2: If no newlines but we have pre-split turns → always use them
    else if (apiTurns && apiTurns.length > 1) {
      // Apply turn limiting with concatenation
      splitMessages = this.applyTurnLimiting(apiTurns, hasNext);
    }
    // Priority 3: No newlines and no pre-split turns → don't process
    else {
      return false;
    }
    
    // Generate a unique group ID and capture the timestamp for this set of split messages
    const groupTimestamp = Date.now();
    const groupId = `group_${groupTimestamp}_${Math.random().toString(36).substr(2, 9)}`;
    
    
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
      groupTimestamp: groupTimestamp, // Store the original group creation timestamp
      // Only add violations, tool calls, and hasNext to the last message in the group
      compliance_violations: index === splitMessages.length - 1 ? complianceViolations : undefined,
      tool_calls: index === splitMessages.length - 1 ? toolCalls : undefined,
      hasNext: index === splitMessages.length - 1 ? hasNext : undefined,
      // Only add reasoning to the first message in the group to avoid duplication
      reasoning: index === 0 ? reasoning : undefined
    }));
    
    // If there's an image prompt, add an image generation message to the queue
    if (imagePrompt) {
      
      const imageDelay = this.calculateDelayForTurn(''); // Small delay for image generation
      const imageMessage: QueuedMessage = {
        content: '', // No text content for image generation
        delay: imageDelay,
        timestamp: 0, // Will be set when processed
        turnIndex: splitMessages.length, // After all text messages
        totalTurns: splitMessages.length + 1, // Include image in total
        groupId: groupId,
        messageIndex: splitMessages.length,
        totalInGroup: splitMessages.length + 1,
        messageType: 'image',
        imagePrompt: imagePrompt,
        hasNext: hasNext
      };
      queuedMessages.push(imageMessage);
      
      // Update totalInGroup for all messages to include the image
      queuedMessages.forEach(msg => {
        msg.totalInGroup = splitMessages.length + 1;
        msg.totalTurns = splitMessages.length + 1;
      });
    }
    
    // Enqueue the messages - they will be added to history with group metadata
    
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
   * Apply turn limiting with concatenation logic
   * @param turns Array of turn content strings
   * @param hasNext Whether there's a follow-up request
   * @returns Array of processed turn messages
   */
  private applyTurnLimiting(
    turns: string[],
    hasNext?: boolean
  ): { content: string; delay: number; turnIndex: number; totalTurns: number }[] {
    const maxTurns = this.config?.maxTurns ?? 3;
    
    // Calculate the maximum possible turns (accounting for hasNext)
    const maxPossibleTurns = hasNext ? maxTurns - 1 : maxTurns;
    
    // Determine the upper limit for concatenation
    const upperLimit = Math.min(turns.length, maxPossibleTurns);
    
    // Randomly choose target turns between 1 and upperLimit (inclusive)
    const targetTurns = Math.floor(Math.random() * upperLimit) + 1;
    
    // Concatenate turns to fit within target
    return this.concatenateTurns(turns, targetTurns);
  }
  
  /**
   * Concatenate turns intelligently to fit within target count
   * @param turns Array of turn content strings
   * @param targetCount Target number of turns
   * @returns Concatenated turns
   */
  private concatenateTurns(
    turns: string[],
    targetCount: number
  ): { content: string; delay: number; turnIndex: number; totalTurns: number }[] {
    if (turns.length <= targetCount) {
      return turns.map((turn, index) => ({
        content: turn.trim(),
        delay: index === 0 ? 0 : this.calculateDelayForTurn(turn.trim()),
        turnIndex: index,
        totalTurns: turns.length
      }));
    }
    
    const result: { content: string; delay: number; turnIndex: number; totalTurns: number }[] = [];
    
    // Calculate how many turns to put in each group
    // Distribute turns as evenly as possible across target groups
    const baseTurnsPerGroup = Math.floor(turns.length / targetCount);
    const extraTurns = turns.length % targetCount;
    
    let currentIndex = 0;
    
    for (let groupIndex = 0; groupIndex < targetCount; groupIndex++) {
      // Some groups get one extra turn to distribute remainder evenly
      const turnsInThisGroup = baseTurnsPerGroup + (groupIndex < extraTurns ? 1 : 0);
      
      const group = turns.slice(currentIndex, currentIndex + turnsInThisGroup);
      const concatenatedContent = group.map(turn => turn.trim()).join(' ');
      
      result.push({
        content: concatenatedContent,
        delay: groupIndex === 0 ? 0 : this.calculateDelayForTurn(concatenatedContent),
        turnIndex: groupIndex,
        totalTurns: targetCount
      });
      
      currentIndex += turnsInThisGroup;
    }
    
    return result;
  }

  /**
   * Cancel any pending messages (called when user sends new message)
   * @returns Number of messages that were canceled
   */
  public cancelPendingMessages(): number {
    if (!this.messageQueue) return 0;
    
    // Get the specific message IDs that will be canceled (only pending ones)
    const canceledMessageIds = this.messageQueue.getCanceledMessageIds();
    
    // Track these specific message IDs to prevent them from being added to history
    // Note: This does NOT affect already-processed messages from the same group
    canceledMessageIds.forEach(messageId => this.canceledMessageIds.add(messageId));
    
    // Also set the canceled message IDs in the MessageQueue to prevent processing
    this.messageQueue.setCanceledMessageIds(canceledMessageIds);
    
    return this.messageQueue.cancelRemaining();
  }
  
  /**
   * Clear all messages and reset state
   */
  public clear(): void {
    if (this.messageQueue) {
      this.messageQueue.clear();
    }
    // Clear canceled message IDs when clearing the manager
    this.canceledMessageIds.clear();
  }
  
  /**
   * Get the current active group ID (for follow-up cancellation)
   * @returns The group ID of the most recently processed group, or undefined
   */
  public getCurrentGroupId(): string | undefined {
    return this.messageQueue?.getCurrentGroupId();
  }
  
  /**
   * Get the group IDs that were canceled
   * @returns Array of group IDs that were canceled
   */
  public getCanceledGroupIds(): string[] {
    return this.messageQueue?.getCanceledGroupIds() || [];
  }
  
  /**
   * Reset canceled message tracking when a new conversation starts
   */
  public resetCanceledGroups(): void {
    this.canceledMessageIds.clear();
  }
  
  /**
   * Update the conversation ID for a new conversation
   * @param conversationId The new conversation ID
   */
  public updateConversationId(conversationId: string): void {
    this.conversationId = conversationId;
    if (this.messageQueue) {
      this.messageQueue.updateConversationId(conversationId);
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
}