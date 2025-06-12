import { RequestUtil, ApiError } from './RequestUtil';
import type { AnimusChatOptions } from './AnimusClient'; // Import the new type
import { ConversationalTurnsManager, ConversationalTurnsConfigValidator } from './conversational-turns';
import type { GroupMetadata } from './conversational-turns/types';
import type {
  ToolCall,
  Tool,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk
} from './chat/types';
import { ChatHistory } from './chat/ChatHistory';
import { StreamingHandler } from './chat/StreamingHandler';
import { FollowUpHandler } from './chat/FollowUpHandler';
import { ChatRequestBuilder } from './chat/ChatRequestBuilder';


/**
 * Module for interacting with the Chat Completions API.
 */
export class ChatModule {
  private requestUtil: RequestUtil;
  private config?: AnimusChatOptions; // Store the provided chat config
  private systemMessage?: ChatMessage; // Derived from config
  private chatHistory: ChatHistory; // Chat history manager
  
  // Reference to the parent client's generateImage function
  private generateImage?: (prompt: string, inputImageUrl?: string) => Promise<string>;
  
  // Event emitter for conversational turn events (passed from AnimusClient)
  private eventEmitter?: (event: string, data: any) => void;
  
  // Conversational turns manager
  private conversationalTurnsManager?: ConversationalTurnsManager;
  
  // Streaming handler for processing streaming responses
  private streamingHandler: StreamingHandler;
  
  // Follow-up handler for managing follow-up requests
  private followUpHandler: FollowUpHandler;
  
  // Request builder for handling all request construction
  private requestBuilder: ChatRequestBuilder;

  constructor(
      requestUtil: RequestUtil,
      chatOptions: AnimusChatOptions | undefined, // Receive the whole config object or undefined
      // Add generateImage function from parent client
      generateImage?: (prompt: string, inputImageUrl?: string) => Promise<string>,
      // Add event emitter for conversational turn events
      eventEmitter?: (event: string, data: any) => void
  ) {
    this.requestUtil = requestUtil;
    this.config = chatOptions;
    this.eventEmitter = eventEmitter;
    this.generateImage = generateImage;

    // Initialize chat history manager
    this.chatHistory = new ChatHistory(chatOptions);

    // Set system message if config is provided
     if (this.config?.systemMessage) {
         this.systemMessage = { role: 'system', content: this.config.systemMessage };
     }
     
     // Initialize request builder
     this.requestBuilder = new ChatRequestBuilder(this.config, this.systemMessage, this.chatHistory);
     
     // Initialize follow-up handler first (before conversational turns)
     this.followUpHandler = new FollowUpHandler(
       this.requestUtil,
       this.config,
       this.chatHistory,
       this.eventEmitter,
       undefined, // conversationalTurnsManager will be set later
       this.addAssistantResponseToHistory.bind(this),
       this.generateImageAndHandleNext.bind(this),
       this.systemMessage
     );
     
     // Initialize conversational turns if enabled
     this.initializeConversationalTurns();
     
     // Initialize streaming handler
     this.streamingHandler = new StreamingHandler(
       this.eventEmitter,
       this.conversationalTurnsManager,
       this.chatHistory,
       this.addAssistantResponseToHistory.bind(this),
       this.followUpHandler.sendFollowUpRequest.bind(this.followUpHandler)
     );
     // Note: Model check happens within completions/send if needed
   }
   
   /**
    * Initialize conversational turns manager if autoTurn is enabled
    */
   private initializeConversationalTurns(): void {
     
     if (this.config?.autoTurn) {
       let config;
       
       // Handle both boolean and object configurations
       if (typeof this.config.autoTurn === 'boolean') {
         config = ConversationalTurnsConfigValidator.fromAutoTurn(this.config.autoTurn);
       } else {
         // It's a ConversationalTurnsConfig object
         config = ConversationalTurnsConfigValidator.mergeWithDefaults(this.config.autoTurn);
       }
       
       
       this.conversationalTurnsManager = new ConversationalTurnsManager(
         config,
         (content, violations, toolCalls, groupMetadata, messageType, imagePrompt, hasNext, reasoning) => {
           if (messageType === 'image' && imagePrompt) {
             // Handle image generation
             
             this.generateImageAndHandleNext(imagePrompt, hasNext);
           } else {
             // Handle regular text message
             this.addAssistantResponseToHistory(content, violations, toolCalls, groupMetadata, reasoning);
             
             // Handle automatic follow-up if next is true (for conversational turns)
             if (hasNext) {
               this.followUpHandler.sendFollowUpRequest();
             }
           }
         },
         this.eventEmitter
       );
       
       // Update follow-up handler with new conversational turns manager
       this.followUpHandler.updateConversationalTurnsManager(this.conversationalTurnsManager);
       
       // Update streaming handler with new conversational turns manager
       if (this.streamingHandler) {
         this.streamingHandler = new StreamingHandler(
           this.eventEmitter,
           this.conversationalTurnsManager,
           this.chatHistory,
           this.addAssistantResponseToHistory.bind(this),
           this.followUpHandler.sendFollowUpRequest.bind(this.followUpHandler)
         );
       }
       
       // Set up listener for conversational turns completion to handle pending follow-ups
       if (this.eventEmitter) {
         const originalEmitter = this.eventEmitter;
         this.eventEmitter = (event: string, data: any) => {
           if (event === 'conversationalTurnsComplete' && this.followUpHandler.hasPendingFollowUpRequest()) {
             this.followUpHandler.handleConversationalTurnsComplete();
           }
           originalEmitter(event, data);
         };
       }
     } else {
       
     }
   }
   
   
   /**
    * Updates the configuration options for this chat module.
    * Allows changing the system message, temperature, etc. dynamically.
    * @param config Updated chat configuration options
    */
   public updateConfig(config: AnimusChatOptions): void {
     // Skip if no config provided
     if (!config) return;

     // Update the stored config
     this.config = config;

     // Update chat history manager config
     this.chatHistory.updateConfig(config);

     // Update system message if it changed
     if (config.systemMessage) {
       this.systemMessage = { role: 'system', content: config.systemMessage };
     }

     // Reinitialize conversational turns if autoTurn configuration changed
     this.initializeConversationalTurns();

     // Update follow-up handler with new configuration
     this.followUpHandler.updateConfig(config, this.systemMessage);
     
     // Update streaming handler with new configuration
     this.streamingHandler = new StreamingHandler(
       this.eventEmitter,
       this.conversationalTurnsManager,
       this.chatHistory,
       this.addAssistantResponseToHistory.bind(this),
       this.followUpHandler.sendFollowUpRequest.bind(this.followUpHandler)
     );
     
     // Update request builder with new configuration
     this.requestBuilder.updateConfig(config, this.systemMessage);
     
   }

  /**
   * Creates a model response for the given chat conversation.
   * Only includes optional parameters in the API request if they are explicitly provided.
   *
   * @param request - The chat completion request parameters.
   * @returns A Promise resolving to the ChatCompletionResponse if stream is false.
   *          If stream is true, returns void and emits streamChunk/streamComplete events.
   */
  // Restore original overloaded signature
  public async completions(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse>;
  public async completions(
    request: ChatCompletionRequest & { stream: true }
  ): Promise<AsyncIterable<ChatCompletionChunk>>;
  public async completions(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse | AsyncIterable<ChatCompletionChunk>> {

    // Build the complete request payload using ChatRequestBuilder
    const payload = this.requestBuilder.buildCompletionRequest(request);
    
    // Capture the intended stream value before any modifications
    const isStreamingRequest = payload.stream;

    // Store request parameters for follow-up requests (excluding messages)
    this.followUpHandler.storeRequestParameters(payload);

    if (isStreamingRequest) { // Check the captured value
      // Store the user messages that were sent *before* processing the stream
      const sentUserMessages = request.messages;

      // --- History Update: Add User Message(s) BEFORE stream starts ---
      sentUserMessages.forEach(msg => this.chatHistory.addUserMessageToHistory(msg));
      // ----------------------------------------------------------------

      
      const response = await this.requestUtil.request(
        'POST',
        '/chat/completions',
        payload,
        true // Indicate streaming
      ) as Response; // Expecting raw Response for streaming

      if (!response.body) {
        // Attempt to remove user messages if stream fails immediately? Less critical now.
        throw new ApiError('Streaming response body is null', response.status);
      }

      // --- Return AsyncGenerator for HTTP Stream ---
      // Use the StreamingHandler to process the stream
      return this.streamingHandler.processStream(response);
    } else {
      // Non-streaming case (history update logic remains here)
      
      const response = await this.requestUtil.request<ChatCompletionResponse>(
        'POST',
        '/chat/completions',
        payload,
        false // Indicate non-streaming
      );
      
      // --- Update History (Non-Streaming) ---
      const historySize = this.config?.historySize ?? 0;
      // Only update history if historySize > 0
      if (historySize > 0) {
          // Add the user message(s) from the original request
          request.messages.forEach(msg => this.chatHistory.addUserMessageToHistory(msg));
          // Add the assistant's response only if no compliance violations
          const assistantMessage = response.choices?.[0]?.message;
          const assistantMessageContent = response.choices?.[0]?.message?.content;
          const assistantReasoning = response.choices?.[0]?.message?.reasoning;
          const assistantToolCalls = response.choices?.[0]?.message?.tool_calls;

          if (assistantMessageContent !== undefined || assistantToolCalls) {
              
              
              // Extract turns, next, and image prompt from the API response
              const apiTurns = assistantMessage?.turns;
              const hasNext = assistantMessage?.next;
              const imagePrompt = assistantMessage?.image_prompt;
              
              
              
              // Try to process with conversational turns first
              const wasProcessed = this.conversationalTurnsManager?.processResponse(
                  assistantMessageContent ?? null,
                  response.compliance_violations,
                  assistantToolCalls,
                  apiTurns, // Pass API-provided turns
                  imagePrompt,
                  hasNext,
                  assistantReasoning ?? null // Pass reasoning
              );
              
              
              
              // Always emit messageComplete event regardless of whether turns were processed
              if (this.eventEmitter) {
                this.eventEmitter('messageComplete', {
                  conversationId: `regular_${Date.now()}`,
                  messageType: 'regular',
                  content: assistantMessageContent ?? '',
                  ...(assistantReasoning && { reasoning: assistantReasoning }),
                  ...(assistantToolCalls && assistantToolCalls.length > 0 && { toolCalls: assistantToolCalls }),
                  ...(assistantMessage?.image_prompt && { imagePrompt: assistantMessage.image_prompt })
                });
              }
              
              // Only add to history directly if not processed by conversational turns
              if (!wasProcessed) {
                  // Use addAssistantResponseToHistory to handle cleaning/trimming and check compliance
                  
                  this.addAssistantResponseToHistory(
                      assistantMessageContent ?? null, // Pass null if content is undefined
                      response.compliance_violations,
                      assistantToolCalls,
                      undefined, // No group metadata for regular responses
                      assistantReasoning ?? null // Pass reasoning from API response
                  );
              }
              
              // Handle automatic follow-up if next is true
              if (hasNext) {
                  
                  this.followUpHandler.sendFollowUpRequest();
              }
          }
          // Trimming is handled within addMessageToHistory
      }
      // --- End History Update ---
      
      // Check if image generation is requested and if the response contains an image prompt
      // Note: We now simply detect the image_prompt but don't automatically generate it
      // The client will handle image generation directly when it detects image_prompt in the response
      if (request.check_image_generation && response.choices?.[0]?.message?.image_prompt) {
          const imagePrompt = response.choices[0].message.image_prompt;
          
          
          // No longer automatically generating the image here
      }
      
      return response;
    }
  }

  /**
   * Sends a user message and processes the AI response through events.
   * This method no longer returns a Promise, and instead emits events for all response handling.
   *
   * Events:
   * - messageStart: When message processing begins
   * - messageTokens: For each token in streaming responses
   * - messageProgress: For partial responses in conversational turns
   * - messageComplete: When the full response is available
   * - messageError: If an error occurs
   *
   * @param messageContent - The content of the user's message
   * @param options - Optional overrides for completion parameters
   */
  public send(
      messageContent: string,
      options?: Omit<ChatCompletionRequest, 'messages' | 'model'> & { model?: string }
  ): void {
      // Generate a unique conversation ID
      const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      // Update the conversation ID in the conversational turns manager
      if (this.conversationalTurnsManager) {
          this.conversationalTurnsManager.updateConversationId(conversationId);
      }
      
      // Cancel any pending conversational turns when a new message is sent
      if (this.conversationalTurnsManager?.isActive()) {
          const canceledCount = this.conversationalTurnsManager.cancelPendingMessages();
          if (canceledCount > 0) {
              // Cancel any follow-up requests associated with ALL canceled groups
              const canceledGroupIds = this.conversationalTurnsManager.getCanceledGroupIds();
              canceledGroupIds.forEach(groupId => {
                  this.followUpHandler.cancelFollowUpForGroup(groupId);
              });
          }
      }
      
      // Reset canceled group tracking for new conversation
      this.conversationalTurnsManager?.resetCanceledGroups();
      
      // Clear any pending follow-up requests when a new message is sent
      // This handles both conversational turn follow-ups and standalone follow-ups
      if (this.followUpHandler.hasPendingFollowUpRequest()) {
          // Cancel any pending follow-up by using its tracked group ID
          const pendingGroupId = this.followUpHandler.getPendingFollowUpGroupId();
          if (pendingGroupId) {
              this.followUpHandler.cancelFollowUpForGroup(pendingGroupId);
          }

          this.followUpHandler.clearPendingFollowUpRequest();
      }
      
      // Reset the image generation flag when a new message is sent
      this.followUpHandler.setJustGeneratedImage(false);
      
      // Reset the sequential follow-up counter when user sends a new message
      this.followUpHandler.resetSequentialFollowUpCount();
      
      // Emit the messageStart event
      if (this.eventEmitter) {
          this.eventEmitter('messageStart', {
            conversationId,
            messageType: 'regular',
            content: messageContent
          });
      }
      
      // Add timestamp to user message
      const timestamp = new Date().toISOString();
      const userMessage: ChatMessage = {
        role: 'user',
        content: messageContent,
        timestamp: timestamp
      };

      // Build the completion request using ChatRequestBuilder
      let completionRequest: ChatCompletionRequest;
      try {
          completionRequest = this.requestBuilder.buildSendRequest(userMessage, options);
      } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (this.eventEmitter) {
              this.eventEmitter('messageError', { error: errorMsg });
          }
          return;
      }
      
      // Store request parameters for follow-up requests (excluding messages)
      this.followUpHandler.storeRequestParameters(completionRequest);
      
      // Process the completion in a non-blocking way using async IIFE
      (async () => {
          try {
              // Prepare messages using ChatRequestBuilder
              const messagesToSend = this.requestBuilder.prepareSendMessages(userMessage);
              
              // Update the messages in the request
              completionRequest.messages = messagesToSend;
              
              // NOW add the message to history AFTER we've prepared the API request
              // This avoids duplicate messages in the completions payload
              // Skip adding [CONTINUE] messages to history
              if (userMessage.content !== '[CONTINUE]') {
                  this.chatHistory.addUserMessageToHistory(userMessage);
              }

              // Make the API request directly (don't use completions to avoid Promise return)
              const isStreaming = completionRequest.stream ?? false;
              const response = isStreaming
                  ? await this.requestUtil.request('POST', '/chat/completions', completionRequest, true)
                  : await this.requestUtil.request('POST', '/chat/completions', completionRequest, false);
              
              if (isStreaming) {
                  // Handle streaming response using StreamingHandler
                  await this.streamingHandler.processSendStream(response as Response);
              } else {
                  // Handle non-streaming response (for autoTurn)
                  // RequestUtil already parsed the JSON for non-streaming requests
                  const jsonResponse = response as ChatCompletionResponse;
                  
                  const choice = jsonResponse.choices?.[0];
                  if (choice?.message) {
                      const message = choice.message;
                      const content = message.content;
                      const reasoning = message.reasoning;
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
                              next,
                              reasoning
                          );
                      }
                      
                      if (!turnsProcessed) {
                          
                          // Emit message complete event
                          if (this.eventEmitter) {
                              this.eventEmitter('messageComplete', {
                                  content: content || '',
                                  ...(reasoning && { reasoning }),
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
                              reasoning
                          );
                      }
                      
                      // Handle image generation and follow-up requests
                      if (imagePrompt && !turnsProcessed) {
                          // Only generate image immediately if turns were NOT processed
                          // If turns were processed, image generation is handled by the queue
                          this.generateImageAndHandleNext(imagePrompt, next);
                      } else if (next && !turnsProcessed) {
                          // Only handle follow-up immediately if turns were NOT processed
                          if (turnsProcessed) {
                              // If turns were processed, store the follow-up request for later
                              this.followUpHandler.setPendingFollowUpRequest(true);
                          } else {
                              // Handle follow-up immediately if no turns were processed
                              this.followUpHandler.sendFollowUpRequest();
                          }
                      }
                  }
              }
              
          } catch (error) {
              // Emit error event
              if (this.eventEmitter) {
                  this.eventEmitter('messageError', { 
                      error: error instanceof Error ? error : String(error) 
                  });
              }
          }
      })();
      
      // No return value - all responses handled through events
  }

  /**
   * Helper method to emit message complete events
   * @param content The complete message content
   * @param toolCalls Any tool calls in the message
   */
  private emitMessageComplete(content: string | null, toolCalls?: ToolCall[]): void {
      if (!this.eventEmitter) return;
      
      this.eventEmitter('messageComplete', {
          content: content || '',
          ...(toolCalls && toolCalls.length > 0 && { toolCalls })
      });
  }


   /**
    * Public method called by AnimusClient to add a completed assistant response to history.
    * @param assistantContent The full, raw content of the assistant's response.
    * @param compliance_violations Optional array of compliance violations detected in the response.
    * @param tool_calls Optional array of tool calls made by the assistant.
    */
   public addAssistantResponseToHistory(
       assistantContent: string | null, // Can be null if only tool_calls are present
       compliance_violations?: string[] | null,
       tool_calls?: ToolCall[],
       groupMetadata?: GroupMetadata,
       reasoning?: string | null // Add reasoning parameter
   ): void {
       this.chatHistory.addAssistantResponseToHistory(
           assistantContent,
           compliance_violations,
           tool_calls,
           groupMetadata,
           reasoning
       );
   }


   /**
    * Returns a copy of the current chat history.
    * @returns A copy of the chat history array
    */
   public getChatHistory(): ChatMessage[] {
       return this.chatHistory.getChatHistory();
   }

   /**
    * Replaces the current chat history with a new array of messages.
    * Useful for importing history from external storage or restoring a previous conversation.
    *
    * @param history - The array of messages to set as the new chat history
    * @param validate - Optional (default: true): Whether to validate and process the messages before setting
    * @returns The number of messages successfully imported
    */
   public setChatHistory(history: ChatMessage[], validate: boolean = true): number {
       return this.chatHistory.setChatHistory(history, validate);
   }

   /**
    * Updates a specific message in the chat history by index.
    *
    * @param index - The index of the message to update
    * @param updatedMessage - The new message content or partial update
    * @returns boolean indicating success
    */
   public updateHistoryMessage(index: number, updatedMessage: Partial<ChatMessage>): boolean {
       return this.chatHistory.updateHistoryMessage(index, updatedMessage);
   }

   /**
    * Deletes a specific message from the chat history by index.
    *
    * @param index - The index of the message to delete
    * @returns boolean indicating success
    */
   public deleteHistoryMessage(index: number): boolean {
       return this.chatHistory.deleteHistoryMessage(index);
   }
   
   /**
    * Cancels any pending conversational turns
    * @returns The number of turns that were canceled
    */
   public cancelPendingTurns(): number {
       if (!this.conversationalTurnsManager) {
           return 0;
       }
       
       return this.conversationalTurnsManager.cancelPendingMessages();
   }

   /**
    * Clears the entire chat history.
    * This will remove all user and assistant messages, but won't affect the system message.
    * @returns The number of messages that were cleared
    */
   public clearChatHistory(): number {
       return this.chatHistory.clearChatHistory();
   }

   
   
   /**
    * Handle post-response actions (image generation and follow-up) when no conversational turns are involved
    * @param imagePrompt Optional image prompt to generate
    * @param next Whether to send a follow-up request
    */
   private handlePostResponseActions(imagePrompt?: string, next?: boolean): void {
       if (imagePrompt) {
           this.generateImageAndHandleNext(imagePrompt, next);
       } else if (next) {
           this.followUpHandler.sendFollowUpRequest();
       }
   }


   /**
    * Generate an image and handle follow-up request after completion
    * @param imagePrompt The image prompt to generate
    * @param next Whether to send a follow-up request after image generation
    */
   private generateImageAndHandleNext(imagePrompt: string, next?: boolean): void {
       // If we have access to the generateImage method, use it and wait for completion
       // Note: The generateImage method handles all event emissions internally
       if (this.generateImage) {
           this.generateImage(imagePrompt)
               .then((imageUrl: string) => {
                   // Set flag to indicate we just generated an image
                   this.followUpHandler.setJustGeneratedImage(true);
                   
                   if (next) {
                       this.followUpHandler.sendFollowUpRequest();
                   }
               })
               .catch((error: any) => {
                   console.error('Image generation failed:', error);
                   
                   // Set flag even on error to prevent follow-up loops
                   this.followUpHandler.setJustGeneratedImage(true);
                   
                   // The ImageGenerator already emits the error event
                   // Just handle the follow-up if needed
                   if (next) {
                       this.followUpHandler.sendFollowUpRequest();
                   }
               });
       } else {
           // If no image generation method available, emit error and handle follow-up
           if (this.eventEmitter) {
               this.eventEmitter('imageGenerationError', {
                   prompt: imagePrompt,
                   error: 'Image generation method not available'
               });
           }
           
           if (next) {
               // Add a delay to allow UI to handle the error
               setTimeout(() => {
                   this.followUpHandler.sendFollowUpRequest();
               }, 1000); // 1 second delay
           }
       }
   }

}