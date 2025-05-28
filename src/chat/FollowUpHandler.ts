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
  
  // Store last request parameters for follow-up requests
  private lastRequestParameters?: any;
  
  // System message reference
  private systemMessage?: ChatMessage;

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
    }
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
    // Use a short delay to make the follow-up feel natural
    setTimeout(() => {
      this.makeFollowUpApiRequest();
    }, 1000); // 1 second delay to feel natural
  }

  /**
   * Make a follow-up API request without adding any user message
   * This continues the conversation naturally with the existing history
   */
  private async makeFollowUpApiRequest(): Promise<void> {
    try {
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
    }
  }
}