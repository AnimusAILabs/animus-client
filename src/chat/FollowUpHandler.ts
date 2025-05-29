import { RequestUtil } from '../RequestUtil';
import type { AnimusChatOptions } from '../AnimusClient';
import type { ChatMessage, ToolCall, ChatCompletionResponse } from './types';
import type { GroupMetadata } from '../conversational-turns/types';
import type { ConversationalTurnsManager } from '../conversational-turns';
import type { ChatHistory } from './ChatHistory';

/**
 * Handles all follow-up request functionality for chat completions.
 * This class encapsulates the logic for managing pending follow-up requests,
 * storing request parameters, and making automatic follow-up API calls.
 */
export class FollowUpHandler {
  private requestUtil: RequestUtil;
  private config?: AnimusChatOptions;
  private chatHistory: ChatHistory;
  private eventEmitter?: (event: string, data: any) => void;
  private conversationalTurnsManager?: ConversationalTurnsManager;
  private addAssistantResponseToHistory: (
    content: string | null,
    violations?: string[] | null,
    toolCalls?: ToolCall[],
    groupMetadata?: GroupMetadata,
    reasoning?: string | null
  ) => void;
  private generateImageAndHandleNext: (imagePrompt: string, next?: boolean) => void;
  
  // Track pending follow-up requests
  private pendingFollowUpRequest: boolean = false;
  private followUpRequestInProgress: boolean = false;
  
  // Track if we just generated an image to limit follow-ups
  private justGeneratedImage: boolean = false;
  
  // Track sequential follow-ups to limit them
  private sequentialFollowUpCount: number = 0;
  private readonly maxSequentialFollowUps: number;
  private readonly followUpDelay: number;
  
  // Store last request parameters for follow-up requests
  private lastRequestParameters?: any;
  
  // System message reference
  private systemMessage?: ChatMessage;
  
  // Track the group ID associated with pending follow-up
  private pendingFollowUpGroupId?: string;
  
  // Track the timeout for pending follow-up to allow cancellation
  private pendingFollowUpTimeout?: NodeJS.Timeout;

  constructor(
    requestUtil: RequestUtil,
    config: AnimusChatOptions | undefined,
    chatHistory: ChatHistory,
    eventEmitter: ((event: string, data: any) => void) | undefined,
    conversationalTurnsManager: ConversationalTurnsManager | undefined,
    addAssistantResponseToHistory: (
      content: string | null,
      violations?: string[] | null,
      toolCalls?: ToolCall[],
      groupMetadata?: GroupMetadata,
      reasoning?: string | null
    ) => void,
    generateImageAndHandleNext: (imagePrompt: string, next?: boolean) => void,
    systemMessage?: ChatMessage
  ) {
    this.requestUtil = requestUtil;
    this.config = config;
    this.chatHistory = chatHistory;
    this.eventEmitter = eventEmitter;
    this.conversationalTurnsManager = conversationalTurnsManager;
    this.addAssistantResponseToHistory = addAssistantResponseToHistory;
    this.generateImageAndHandleNext = generateImageAndHandleNext;
    this.systemMessage = systemMessage;
    
    // Extract follow-up configuration from autoTurn config
    const autoTurnConfig = typeof config?.autoTurn === 'object' ? config.autoTurn : undefined;
    this.followUpDelay = autoTurnConfig?.followUpDelay ?? 2000; // Default 2 seconds
    this.maxSequentialFollowUps = autoTurnConfig?.maxSequentialFollowUps ?? 2; // Default 2
  }

  /**
   * Updates the configuration and system message for follow-up requests
   */
  public updateConfig(config: AnimusChatOptions, systemMessage?: ChatMessage): void {
    this.config = config;
    if (systemMessage) {
      this.systemMessage = systemMessage;
    }
  }

  /**
   * Updates the conversational turns manager reference
   */
  public updateConversationalTurnsManager(manager?: ConversationalTurnsManager): void {
    this.conversationalTurnsManager = manager;
  }

  /**
   * Stores request parameters for potential follow-up requests
   * @param parameters The request parameters to store (excluding messages)
   */
  public storeRequestParameters(parameters: any): void {
    this.lastRequestParameters = { ...parameters };
    delete this.lastRequestParameters.messages; // Don't store messages as they'll be rebuilt
  }

  /**
   * Checks if there is a pending follow-up request
   */
  public hasPendingFollowUpRequest(): boolean {
    return this.pendingFollowUpRequest;
  }

  /**
   * Sets the pending follow-up request state
   */
  public setPendingFollowUpRequest(pending: boolean): void {
    this.pendingFollowUpRequest = pending;
  }

  /**
   * Clears any pending follow-up requests
   */
  public clearPendingFollowUpRequest(): void {
    if (this.pendingFollowUpRequest) {
      this.pendingFollowUpRequest = false;
      this.pendingFollowUpGroupId = undefined;
    }
  }
  
  /**
   * Get the group ID of the pending follow-up request
   * @returns The group ID of the pending follow-up, or undefined if none
   */
  public getPendingFollowUpGroupId(): string | undefined {
    return this.pendingFollowUpGroupId;
  }

  /**
   * Cancel follow-up request if it's associated with a canceled group
   * @param canceledGroupId The group ID that was canceled
   */
  public cancelFollowUpForGroup(canceledGroupId: string): void {
    if (this.pendingFollowUpRequest && this.pendingFollowUpGroupId === canceledGroupId) {
      this.pendingFollowUpRequest = false;
      this.pendingFollowUpGroupId = undefined;
      
      // Cancel the pending timeout to prevent the follow-up from executing
      if (this.pendingFollowUpTimeout) {
        clearTimeout(this.pendingFollowUpTimeout);
        this.pendingFollowUpTimeout = undefined;
      }
    }
  }

  /**
   * Sets the flag indicating we just generated an image
   */
  public setJustGeneratedImage(value: boolean): void {
    this.justGeneratedImage = value;
  }

  /**
   * Resets the sequential follow-up counter when user sends a new message
   */
  public resetSequentialFollowUpCount(): void {
    this.sequentialFollowUpCount = 0;
  }

  /**
   * Handles follow-up request when conversational turns are complete
   * This is called by the event listener in ChatModule
   */
  public handleConversationalTurnsComplete(): void {
    if (this.pendingFollowUpRequest) {
      this.pendingFollowUpRequest = false;
      this.sendFollowUpRequest();
    }
  }

  /**
   * Send an automatic follow-up request when the API indicates more content is expected
   * This is called when the response has next=true
   */
  public sendFollowUpRequest(): void {
    // Check if we've exceeded the maximum sequential follow-ups
    if (this.sequentialFollowUpCount >= this.maxSequentialFollowUps) {
      return;
    }
    
    // Check if we just generated an image (should limit follow-ups)
    if (this.justGeneratedImage) {
      return;
    }
    
    // Prevent multiple concurrent follow-up requests for the same response
    if (this.pendingFollowUpRequest) {
      return;
    }
    
    // Set pending flag to prevent concurrent requests
    this.pendingFollowUpRequest = true;
    
    // Track the group ID for this follow-up request
    // If there's no conversational turns group, use a unique ID for this follow-up
    this.pendingFollowUpGroupId = this.conversationalTurnsManager?.getCurrentGroupId() || `followup_${Date.now()}`;
    
    // Increment the sequential follow-up counter
    this.sequentialFollowUpCount++;
    
    // Use configurable delay to make the follow-up feel natural
    this.pendingFollowUpTimeout = setTimeout(() => {
      this.makeFollowUpApiRequest();
    }, this.followUpDelay);
  }

  /**
   * Make a follow-up API request without adding any user message
   * This continues the conversation naturally with the existing history
   */
  private async makeFollowUpApiRequest(): Promise<void> {
    try {
      // Check if the follow-up was canceled (group was canceled)
      if (!this.pendingFollowUpRequest) {
        return; // Follow-up was canceled, don't make the request
      }
      
      // Set flag to indicate request is in progress
      this.followUpRequestInProgress = true;
      
      // Clear the timeout since we're now executing
      this.pendingFollowUpTimeout = undefined;
      
      // Double-check if the follow-up was canceled while we were waiting
      if (!this.pendingFollowUpRequest) {
        return; // Follow-up was canceled during the delay
      }
      
      // Prepare the API request with current history (no new user message)
      const messagesToSend = [this.systemMessage!];
      // Add history if applicable
      const historySize = this.config?.historySize ?? 0;
      if (historySize > 0 && this.chatHistory.getHistoryLength() > 0) {
        const historyCount = Math.min(this.chatHistory.getHistoryLength(), historySize);
        const historyMessages = this.chatHistory.getRawHistory().slice(-historyCount);
        const reconstructedHistory = this.chatHistory.reconstructGroupedMessages(historyMessages);
        messagesToSend.push(...reconstructedHistory);
      }
      
      // Create the completion request using stored parameters from the original request
      const completionRequest: any = {
        messages: messagesToSend,
        // Use all parameters from the last request to maintain consistency
        ...(this.lastRequestParameters || {}),
        // Override specific parameters for follow-up requests
        max_tokens: Math.min(this.lastRequestParameters?.max_tokens || 150, 150), // Limit follow-up tokens
        stream: false // Always use non-streaming for follow-ups
      };
      
      // Remove undefined values
      Object.keys(completionRequest).forEach(key => {
        if (completionRequest[key] === undefined) {
          delete completionRequest[key];
        }
      });
      
      // Emit messageStart event for follow-up request
      if (this.eventEmitter) {
        this.eventEmitter('messageStart', {
          conversationId: `followup_${Date.now()}`,
          messageType: 'followup',
          content: '' // Follow-up requests don't have user content
        });
      }
      
      // Make the API request
      const response = await this.requestUtil.request('POST', '/chat/completions', completionRequest, false);
      const jsonResponse = response as ChatCompletionResponse;
      
      // Final check: if the follow-up was canceled while the API request was in progress,
      // don't process the response
      if (!this.pendingFollowUpRequest) {
        return; // Follow-up was canceled while API request was in progress
      }
      
      // Process the response the same way as normal responses
      const choice = jsonResponse.choices?.[0];
      if (choice?.message) {
        const message = choice.message;
        const content = message.content;
        const toolCalls = message.tool_calls;
        const turns = message.turns;
        const next = message.next;
        const imagePrompt = message.image_prompt;
        
        // Handle conversational turns if available
        let turnsProcessed = false;
        if (this.conversationalTurnsManager && turns && turns.length > 0) {
          turnsProcessed = this.conversationalTurnsManager.processResponse(
            content,
            jsonResponse.compliance_violations,
            toolCalls,
            turns,
            imagePrompt,
            next
          );
        }
        
        if (!turnsProcessed) {
          // Emit message complete event
          if (this.eventEmitter) {
            this.eventEmitter('messageComplete', {
              conversationId: `followup_${Date.now()}`,
              messageType: 'followup',
              content: content || '',
              ...(toolCalls && { toolCalls }),
              ...(imagePrompt && { imagePrompt })
            });
          }
          
          // Add to history
          this.addAssistantResponseToHistory(
            content,
            jsonResponse.compliance_violations,
            toolCalls,
            undefined,
            null
          );
        }
        
        // Handle image generation and follow-up requests
        if (imagePrompt && !turnsProcessed) {
          // Only generate image immediately if turns were NOT processed
          this.generateImageAndHandleNext(imagePrompt, next);
        } else if (next && !turnsProcessed) {
          // Only handle follow-up immediately if turns were NOT processed
          if (turnsProcessed) {
            // If turns were processed, store the follow-up request for later
            this.pendingFollowUpRequest = true;
          } else if (this.justGeneratedImage) {
            // If we just generated an image, don't trigger another follow-up to prevent loops
            this.justGeneratedImage = false; // Reset the flag
          } else if (this.sequentialFollowUpCount >= this.maxSequentialFollowUps) {
            // If we've reached the max sequential follow-ups, don't trigger another
          } else {
            // Handle follow-up immediately if no turns were processed
            this.sendFollowUpRequest();
          }
        }
      }
      
    } catch (error) {
      if (this.eventEmitter) {
        this.eventEmitter('messageError', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } finally {
      // Clear the pending flag regardless of success or failure
      this.pendingFollowUpRequest = false;
      this.followUpRequestInProgress = false;
    }
  }
}