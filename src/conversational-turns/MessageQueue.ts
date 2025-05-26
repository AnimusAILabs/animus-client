import { QueuedMessage, MessageCallback, EventEmitter, MessageCompleteData } from './types';

/**
 * Manages a queue of messages with delays and cancellation support
 */
export class MessageQueue {
  private queue: QueuedMessage[] = [];
  private currentTimeout?: NodeJS.Timeout;
  private isProcessing: boolean = false;
  private processedCount: number = 0;
  
  constructor(
    private onMessageCallback: MessageCallback,
    private eventEmitter?: EventEmitter,
    private conversationId: string = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  ) {}
  
  /**
   * Add messages to the queue and start processing if not already running
   * @param messages Array of messages to add to the queue
   */
  public enqueue(messages: QueuedMessage[]): void {
    this.queue.push(...messages);
    if (!this.isProcessing) {
      this.processNext();
    }
  }
  
  /**
   * Cancel remaining messages but allow current message to complete
   * @returns Number of messages that were canceled
   */
  public cancelRemaining(): number {
    const canceledCount = this.queue.length;
    
    // Clear timeout for next message
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
      this.currentTimeout = undefined;
    }
    
    // Clear remaining queue but don't interrupt current message
    this.queue = [];
    
    // Emit cancellation event if there were messages to cancel
    if (canceledCount > 0 && this.eventEmitter) {
      this.eventEmitter('messageError', {
        conversationId: this.conversationId,
        messageType: 'auto',
        error: `Canceled ${canceledCount} pending messages`,
        totalTurns: canceledCount
      });
    }
    
    return canceledCount;
  }
  
  /**
   * Clear all messages and stop processing completely
   */
  public clear(): void {
    this.cancelRemaining();
    this.isProcessing = false;
    this.processedCount = 0;
  }
  
  /**
   * Get current queue status for debugging and monitoring
   * @returns Object with queue length, processing state, and processed count
   */
  public getStatus(): { 
    queueLength: number; 
    isProcessing: boolean; 
    processedCount: number; 
  } {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      processedCount: this.processedCount
    };
  }
  
  /**
   * Check if the queue is currently processing messages
   * @returns True if processing, false otherwise
   */
  public isActive(): boolean {
    return this.isProcessing || this.queue.length > 0;
  }
  
  /**
   * Process the next message in the queue
   */
  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      
      // Emit an "all messages complete" event when queue becomes empty
      if (this.eventEmitter) {
        this.eventEmitter('messageComplete', {
          conversationId: this.conversationId,
          totalMessages: this.processedCount,
          totalTurns: this.processedCount
        });
      }
      return;
    }
    
    this.isProcessing = true;
    const message = this.queue.shift()!;
    
    // Emit message start event
    if (this.eventEmitter) {
      this.eventEmitter('messageStart', {
        conversationId: this.conversationId,
        messageType: 'auto',
        content: message.content,
        turnIndex: message.turnIndex,
        totalTurns: message.totalTurns,
        compliance_violations: message.compliance_violations,
        tool_calls: message.tool_calls
      });
    }
    
    const processMessage = () => {
      // Set the timestamp when the message is actually processed (not when queued)
      // This ensures proper chronological ordering in chat history
      const processedTimestamp = Date.now();
      
      // Call the message callback to actually process/display the message
      // Pass group metadata as part of the message processing, including the processed timestamp
      this.onMessageCallback(
        message.content,
        message.compliance_violations,
        message.tool_calls,
        // Pass group metadata for history storage
        {
          groupId: message.groupId,
          messageIndex: message.messageIndex,
          totalInGroup: message.totalInGroup,
          processedTimestamp: processedTimestamp // Add the actual processing timestamp
        }
      );
      
      this.processedCount++;
      
      // Emit individual message complete event
      if (this.eventEmitter) {
        this.eventEmitter('messageComplete', {
          conversationId: this.conversationId,
          messageType: 'auto',
          content: message.content,
          turnIndex: message.turnIndex,
          totalTurns: message.totalTurns,
          compliance_violations: message.compliance_violations,
          tool_calls: message.tool_calls
        });
      }
      
      // Process next message in queue
      this.processNext();
    };
    
    if (message.delay > 0) {
      // Schedule the message to be processed after the delay
      this.currentTimeout = setTimeout(processMessage, message.delay);
    } else {
      // Process immediately if no delay
      processMessage();
    }
  }
}