import { ConversationalTurnsConfig, QueuedMessage, MessageCallback, EventEmitter } from './types';
import { ConversationalTurnsConfigValidator } from './config';
import { ResponseSplitter } from './ResponseSplitter';
import { MessageQueue } from './MessageQueue';
import type { ToolCall } from '../chat/types';

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
      const groupAwareCallback = (
        content: string | null,
        violations?: string[],
        toolCalls?: any[],
        groupMetadata?: any,
        messageType?: 'text' | 'image',
        imagePrompt?: string,
        hasNext?: boolean
      ) => {
        
        if (onMessageCallback) {
          onMessageCallback(content, violations, toolCalls, groupMetadata, messageType, imagePrompt, hasNext);
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
    hasNext?: boolean
  ): boolean {
    // Return false if feature is disabled or no content
    if (!this.messageQueue || !content) {
      
      return false;
    }
    
    let splitMessages: { content: string; delay: number; turnIndex: number; totalTurns: number }[];
    
    // Check if content contains newlines
    const hasNewlines = content.includes('\n');
    
    // Check splitProbability - but newlines override this
    const shouldSplit = hasNewlines || Math.random() < (this.config?.splitProbability ?? 1.0);
    
    // If probability check fails and no newlines, don't split
    if (!shouldSplit) {
      return false;
    }
    
    // Splitting logic:
    // 1. If API provided multiple pre-split turns (autoTurn=true, backend split) → use those
    // 2. If autoTurn=true AND content has newlines → split on newlines (overrides probability)
    // 3. If autoTurn=true AND single turn with newlines → split that single turn on newlines
    
    // If API provided pre-split turns (multiple), use those
    if (apiTurns && apiTurns.length > 1) {
      
      splitMessages = apiTurns.map((turn, index) => ({
        content: turn,
        delay: index === 0 ? 0 : this.calculateDelayForTurn(turn),
        turnIndex: index,
        totalTurns: apiTurns.length
      }));
    } else if (hasNewlines && apiTurns) {
      // If autoTurn=true (apiTurns exists) AND content has newlines → split on newlines
      const lines = content.split('\n').filter(line => line.trim());
      if (lines.length > 1) {
        splitMessages = lines.map((line, index) => ({
          content: line.trim(),
          delay: index === 0 ? 0 : this.calculateDelayForTurn(line.trim()),
          turnIndex: index,
          totalTurns: lines.length
        }));
      } else {
        // Single line after filtering, no splitting needed
        return false;
      }
    } else {
      // No splitting conditions met - return false for normal processing
      return false;
    }
    
    // If not split, return false to indicate normal processing should continue
    if (splitMessages.length <= 1) {
      
      return false;
    }
    
    // Apply autoTurn limiting logic
    splitMessages = this.applyAutoTurnLimiting(splitMessages, hasNext);
    
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
      hasNext: index === splitMessages.length - 1 ? hasNext : undefined
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
  
  /**
   * Apply autoTurn limiting logic to split messages
   * @param splitMessages Array of split messages
   * @param hasNext Whether there's a follow-up request
   * @returns Modified array of split messages respecting turn limits
   */
  private applyAutoTurnLimiting(
    splitMessages: { content: string; delay: number; turnIndex: number; totalTurns: number }[],
    hasNext?: boolean
  ): { content: string; delay: number; turnIndex: number; totalTurns: number }[] {
    const maxTurns = this.config?.maxTurns ?? 3;
    const maxTurnConcatProbability = this.config?.maxTurnConcatProbability ?? 0.7;
    
    // Calculate total turns including next flag
    const totalTurns = splitMessages.length + (hasNext ? 1 : 0);
    
    // If within limit, no concatenation needed
    if (totalTurns <= maxTurns) {
      return splitMessages;
    }
    
    // Determine if we should concatenate
    let shouldConcatenate = false;
    
    if (totalTurns > maxTurns) {
      // Always concatenate if exceeds maxTurns
      shouldConcatenate = true;
    } else if (totalTurns === maxTurns) {
      // Use probability if exactly at maxTurns (this case won't be reached due to <= check above)
      shouldConcatenate = Math.random() < maxTurnConcatProbability;
    }
    
    if (!shouldConcatenate) {
      return splitMessages;
    }
    
    // Calculate target number of turns (accounting for next flag)
    let targetTurns: number;
    if (hasNext) {
      // If hasNext, we need to leave room for the next turn
      // So target = maxTurns - 1 (to account for the next turn)
      targetTurns = maxTurns - 1;
    } else {
      // If no hasNext, target should be maxTurns
      targetTurns = maxTurns;
    }
    
    // Ensure we have at least 1 turn
    const finalTargetTurns = Math.max(1, targetTurns);
    
    // Concatenate messages to fit within target
    return this.concatenateMessages(splitMessages, finalTargetTurns);
  }
  
  /**
   * Concatenate messages intelligently to fit within target count
   * @param messages Array of messages to concatenate
   * @param targetCount Target number of messages
   * @returns Concatenated messages
   */
  private concatenateMessages(
    messages: { content: string; delay: number; turnIndex: number; totalTurns: number }[],
    targetCount: number
  ): { content: string; delay: number; turnIndex: number; totalTurns: number }[] {
    if (messages.length <= targetCount) {
      return messages;
    }
    
    const result: { content: string; delay: number; turnIndex: number; totalTurns: number }[] = [];
    
    // Calculate how many messages to put in each group
    // Distribute messages as evenly as possible across target groups
    const baseMessagesPerGroup = Math.floor(messages.length / targetCount);
    const extraMessages = messages.length % targetCount;
    
    let currentIndex = 0;
    
    for (let groupIndex = 0; groupIndex < targetCount; groupIndex++) {
      // Some groups get one extra message to distribute remainder evenly
      const messagesInThisGroup = baseMessagesPerGroup + (groupIndex < extraMessages ? 1 : 0);
      
      const group = messages.slice(currentIndex, currentIndex + messagesInThisGroup);
      const concatenatedContent = group.map(msg => msg.content).join(' ');
      
      // Use the delay of the last message in the group
      const delay = group[group.length - 1]?.delay ?? 0;
      
      result.push({
        content: concatenatedContent,
        delay: delay,
        turnIndex: groupIndex,
        totalTurns: targetCount
      });
      
      currentIndex += messagesInThisGroup;
    }
    
    return result;
  }
}