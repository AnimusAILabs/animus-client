import { RequestUtil, ApiError } from './RequestUtil';
import type { AnimusChatOptions } from './AnimusClient'; // Import the new type
import { ConversationalTurnsManager, ConversationalTurnsConfigValidator } from './conversational-turns';
import type { GroupMetadata } from './conversational-turns/types';
// --- Interfaces based on API Documentation ---

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string of arguments
  };
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: object; // JSON Schema object
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null; // Can be null if tool_calls are present or for tool responses
  name?: string; // Optional name for user/assistant roles
  reasoning?: string; // Optional field to store extracted <think> content
  timestamp?: string; // ISO timestamp when message was created
  tool_calls?: ToolCall[]; // For assistant messages requesting a tool call
  tool_call_id?: string; // For tool messages responding to a tool call
  compliance_violations?: string[]; // Track compliance violations for context
  // Group metadata for conversational turns
  groupId?: string; // Unique identifier for grouped messages
  messageIndex?: number; // Index within the group (0-based)
  totalInGroup?: number; // Total number of messages in the group
}

// Keep all optional fields as optional in the request interface
export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model?: string;
  tools?: Tool[];
  tool_choice?: "none" | "auto" | { type: "function"; function: { name: string } };
  temperature?: number;
  top_p?: number;
  n?: number;
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
  presence_penalty?: number;
  frequency_penalty?: number;
  best_of?: number;
  top_k?: number;
  repetition_penalty?: number;
  min_p?: number;
  length_penalty?: number;
  compliance?: boolean;
  check_image_generation?: boolean;
  autoTurn?: boolean; // Enable autoTurn feature for intelligent conversation splitting
}

// --- Response Interfaces (remain the same) ---

interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null; // Can be null if tool_calls are present
    reasoning?: string; // Reasoning content from the model
    tool_calls?: ToolCall[];
    image_prompt?: string; // Prompt for generating an image
    turns?: string[]; // Array of split conversation turns from autoTurn
    next?: boolean; // Indicates if a follow-up message is likely
  };
  finish_reason: string; // e.g., 'stop', 'length', 'tool_calls'
  compliance_violations?: string[]; // Violations specific to this choice (for n > 1)
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number; // Unix timestamp
  choices: ChatCompletionChoice[];
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  compliance_violations?: string[];
}

interface ChatCompletionChunkChoiceDelta {
  role?: 'assistant';
  content?: string | null; // Can be null
  // For streaming, tool_calls might be partial and include an index
  tool_calls?: (Partial<ToolCall> & { index: number; function?: Partial<ToolCall['function']> })[];
  reasoning?: string | null; // New field for reasoning content in chunks
  turns?: string[]; // Array of split conversation turns from autoTurn
  next?: boolean; // Indicates if a follow-up message is likely
}

interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkChoiceDelta;
  finish_reason: string | null; // Can be 'tool_calls'
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: ChatCompletionResponse['usage'] | null;
  compliance_violations?: string[] | null;
}


/**
 * Module for interacting with the Chat Completions API.
 */
export class ChatModule {
  private requestUtil: RequestUtil;
  private config?: AnimusChatOptions; // Store the provided chat config
  private systemMessage?: ChatMessage; // Derived from config
  private chatHistory: ChatMessage[] = []; // Store conversation history (excluding system message)
  
  // Reference to the parent client's generateImage function
  private generateImage?: (prompt: string) => Promise<string>;
  
  // Event emitter for conversational turn events (passed from AnimusClient)
  private eventEmitter?: (event: string, data: any) => void;
  
  // Conversational turns manager
  private conversationalTurnsManager?: ConversationalTurnsManager;
  
  // Track pending follow-up requests
  private pendingFollowUpRequest: boolean = false;
  
  // Store last request parameters for follow-up requests
  private lastRequestParameters?: any;

  constructor(
      requestUtil: RequestUtil,
      chatOptions: AnimusChatOptions | undefined, // Receive the whole config object or undefined
      // Add generateImage function from parent client
      generateImage?: (prompt: string) => Promise<string>,
      // Add event emitter for conversational turn events
      eventEmitter?: (event: string, data: any) => void
  ) {
    this.requestUtil = requestUtil;
    this.config = chatOptions;
    this.eventEmitter = eventEmitter;
    this.generateImage = generateImage;

    // Set system message if config is provided
     if (this.config?.systemMessage) {
         this.systemMessage = { role: 'system', content: this.config.systemMessage };
     }
     
     // Initialize conversational turns if enabled
     this.initializeConversationalTurns();
     // Note: Model check happens within completions/send if needed
   }
   
   /**
    * Initialize conversational turns manager if autoTurn is enabled
    */
   private initializeConversationalTurns(): void {
     console.log('[Chat] Initializing conversational turns, autoTurn:', this.config?.autoTurn);
     if (this.config?.autoTurn) {
       let config;
       
       // Handle both boolean and object configurations
       if (typeof this.config.autoTurn === 'boolean') {
         config = ConversationalTurnsConfigValidator.fromAutoTurn(this.config.autoTurn);
       } else {
         // It's a ConversationalTurnsConfig object
         config = ConversationalTurnsConfigValidator.mergeWithDefaults(this.config.autoTurn);
       }
       
       console.log('[Chat] Creating conversational turns manager with config:', config);
       this.conversationalTurnsManager = new ConversationalTurnsManager(
         config,
         (content, violations, toolCalls, groupMetadata, messageType, imagePrompt, hasNext) => {
           if (messageType === 'image' && imagePrompt) {
             // Handle image generation
             console.log('[Chat] Processing image generation from queue:', imagePrompt);
             this.generateImageAndHandleNext(imagePrompt, hasNext);
           } else {
             // Handle regular text message
             this.addAssistantResponseToHistory(content, violations, toolCalls, groupMetadata, null);
           }
         },
         this.eventEmitter
       );
       console.log('[Chat] Conversational turns manager created:', !!this.conversationalTurnsManager);
       
       // Set up listener for conversational turns completion to handle pending follow-ups
       if (this.eventEmitter) {
         const originalEmitter = this.eventEmitter;
         this.eventEmitter = (event: string, data: any) => {
           if (event === 'conversationalTurnsComplete' && this.pendingFollowUpRequest) {
             console.log('[Chat] Conversational turns completed, sending pending follow-up request');
             this.pendingFollowUpRequest = false;
             this.sendFollowUpRequest();
           }
           originalEmitter(event, data);
         };
       }
     } else {
       console.log('[Chat] AutoTurn disabled, not creating conversational turns manager');
     }
   }
   
   /**
    * Helper method to determine if autoTurn is enabled from the configuration
    * @param autoTurnConfig The autoTurn configuration (boolean or object)
    * @returns true if autoTurn is enabled, false otherwise
    */
   private getAutoTurnEnabled(autoTurnConfig: boolean | import('./conversational-turns/types').ConversationalTurnsConfig | undefined): boolean {
     if (typeof autoTurnConfig === 'boolean') {
       return autoTurnConfig;
     } else if (typeof autoTurnConfig === 'object' && autoTurnConfig !== null) {
       return autoTurnConfig.enabled;
     }
     return false;
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

     // Update system message if it changed
     if (config.systemMessage) {
       this.systemMessage = { role: 'system', content: config.systemMessage };
     }

     // Reinitialize conversational turns if autoTurn configuration changed
     this.initializeConversationalTurns();

     console.log('[Animus SDK] ChatModule configuration updated:', JSON.stringify({
       model: config.model,
       systemMessage: config.systemMessage ? `${config.systemMessage.substring(0, 20)}...` : undefined,
       historySize: config.historySize,
       temperature: config.temperature,
       stream: config.stream,
       max_tokens: config.max_tokens,
       reasoning: config.reasoning,
       autoTurn: config.autoTurn
     }));
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

    // --- Parameter Validation & Merging ---
    // Validate essential config presence if chat module is used
    if (!this.config?.model) {
        throw new Error('Chat model must be configured in AnimusClient chat options to use chat methods.');
    }
    if (!this.systemMessage) {
        throw new Error('Chat systemMessage must be configured in AnimusClient chat options to use chat methods.');
    }

    const defaults = this.config || {}; // Define defaults earlier

    // Start with defaults from config, then override with request params
    const payload: Record<string, any> = {
        // Core required params (request overrides config)
        model: request.model ?? defaults.model,
        messages: request.messages, // Placeholder, history logic below

        // Optional params (request overrides config)
        temperature: request.temperature ?? defaults.temperature,
        top_p: request.top_p ?? defaults.top_p,
        n: request.n ?? defaults.n,
        max_tokens: request.max_tokens ?? defaults.max_tokens,
        stop: request.stop ?? defaults.stop,
        stream: request.stream ?? defaults.stream ?? false, // Default stream to false if not set anywhere
        presence_penalty: request.presence_penalty ?? defaults.presence_penalty,
        frequency_penalty: request.frequency_penalty ?? defaults.frequency_penalty,
        best_of: request.best_of ?? defaults.best_of,
        top_k: request.top_k ?? defaults.top_k,
        repetition_penalty: request.repetition_penalty ?? defaults.repetition_penalty,
        min_p: request.min_p ?? defaults.min_p,
        length_penalty: request.length_penalty ?? defaults.length_penalty,
        // Compliance defaults to true if not specified in request or config
        compliance: request.compliance ?? defaults.compliance ?? true,
        
        // Add check_image_generation parameter (just like other params)
        check_image_generation: request.check_image_generation,
        
        // Add autoTurn parameter to enable server-side conversation splitting
        autoTurn: request.autoTurn ?? defaults.autoTurn ?? false,

        // Tool calling parameters
        tools: request.tools ?? defaults.tools,
        // tool_choice is set below based on presence of tools
    };

    // Add reasoning parameters if enabled in config or request
    // When enabled, this includes the model's reasoning process in the response
    // For non-streaming, this adds a 'reasoning' field to the response message
    // For streaming, the thinking content is included directly in the stream
    const reasoningEnabled = 'reasoning' in request ? request.reasoning : defaults.reasoning;
    if (reasoningEnabled) {
        payload.reasoning = true;
        payload.show_reasoning = true;
    }

    // Set tool_choice to "auto" if tools are present, otherwise leave it undefined (or "none" if explicitly set in request)
    if (payload.tools && payload.tools.length > 0) {
        // If request specifically said "none", respect it. Otherwise, "auto".
        payload.tool_choice = request.tool_choice === "none" ? "none" : "auto";
    } else if (request.tool_choice) { // If no tools, but tool_choice is in request (e.g. "none")
        payload.tool_choice = request.tool_choice;
    }


    // --- End Parameter Validation & Merging ---

    // --- Decide Path Based on Stream BEFORE Removing Undefined ---
    const isStreamingRequest = payload.stream; // Capture the intended stream value

    // --- Remove Undefined Values ---
    Object.keys(payload).forEach(key => {
       if (payload[key] === undefined) {
           delete payload[key];
       }
    });
    // --- End Remove Undefined Values ---


    // --- System Message & History Management ---
    // Start with the configured system message (already validated above)
    let messagesToSend: ChatMessage[] = [this.systemMessage!]; // Use non-null assertion

    // Add history (if applicable), ensuring it doesn't exceed window size
   const historySize = this.config?.historySize ?? 0;
   // Only apply history if historySize > 0 AND chat config was provided
   if (historySize > 0 && this.chatHistory.length > 0) {
       // Calculate available slots for history (window size minus new user messages)
       const newUserMessages = request.messages; // Assume request.messages are user/assistant
       const availableSlots = historySize - newUserMessages.length;
       if (availableSlots > 0) {
           const historyCount = Math.min(this.chatHistory.length, availableSlots);
           const historyMessages = this.chatHistory.slice(-historyCount);
           
           // Reconstruct grouped messages for API requests
           const reconstructedHistory = this.reconstructGroupedMessages(historyMessages);
           
           // Map reconstructed history to include necessary fields for API payload
           const relevantHistory = reconstructedHistory.map(msg => {
               const historyMsgPayload: Partial<ChatMessage> = {
                   role: msg.role,
                   content: msg.content,
               };
               if (msg.name) {
                   historyMsgPayload.name = msg.name;
               }
               if (msg.role === 'assistant' && msg.tool_calls) {
                   historyMsgPayload.tool_calls = msg.tool_calls;
               }
               return historyMsgPayload as ChatMessage;
           });
           messagesToSend.push(...relevantHistory);
        }
    }

    // Add the new messages from the request
    messagesToSend.push(...request.messages);

    payload.messages = messagesToSend; // Update payload
    // --- End System Message & History Management ---

    // Store request parameters for follow-up requests (excluding messages)
    this.lastRequestParameters = { ...payload };
    delete this.lastRequestParameters.messages; // Don't store messages as they'll be rebuilt

    if (isStreamingRequest) { // Check the captured value
      // Store the user messages that were sent *before* processing the stream
      const sentUserMessages = request.messages;

      // --- History Update: Add User Message(s) BEFORE stream starts ---
      sentUserMessages.forEach(msg => this.addMessageToHistory(msg));
      // ----------------------------------------------------------------

      console.log('[Animus SDK] Sending STREAMING request payload:', JSON.stringify(payload, null, 2)); // Log payload
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
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this; // Capture 'this' for use inside the generator

      async function* processStream(): AsyncIterable<ChatCompletionChunk> {
        let accumulatedContent: string | null = ''; // Can be null if only tool_calls
        let accumulatedToolCalls: ToolCall[] = [];
        let complianceViolations: string[] | undefined;
        let accumulatedTurns: string[] | undefined;
        let hasNext: boolean | undefined;
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              // End of stream reached without [DONE] message (unlikely but handle)
              if (accumulatedContent) {
                 // History update happens *after* the generator finishes or errors
              }
              break; // Exit the loop
            }

            buffer += decoder.decode(value, { stream: true });
            let lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line

            for (const line of lines) {
              if (line.trim() === '') continue;

              if (line.startsWith('data: ')) {
                const data = line.substring(6).trim();
                if (data === '[DONE]') {
                  // Stream is officially complete
                  
                  // Try to process with conversational turns first
                  if (self.conversationalTurnsManager) {
                    console.log('[Chat] Stream complete, processing with conversational turns');
                    console.log('[Chat] Accumulated turns:', accumulatedTurns?.length || 0);
                    console.log('[Chat] Has next:', hasNext);
                    const wasProcessed = self.conversationalTurnsManager.processResponse(
                      accumulatedContent,
                      complianceViolations,
                      accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
                      accumulatedTurns,
                      undefined, // imagePrompt - not supported in streaming yet
                      hasNext
                    );
                    
                    // If not processed by turns manager, emit completion event and add to history directly
                    if (!wasProcessed) {
                      // Emit messageComplete event
                      if (self.eventEmitter) {
                        self.eventEmitter('messageComplete', { 
                          content: accumulatedContent || '',
                          ...(accumulatedToolCalls.length > 0 && { toolCalls: accumulatedToolCalls })
                        });
                      }
                      
                      self.addAssistantResponseToHistory(
                        accumulatedContent,
                        complianceViolations,
                        accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
                        undefined,
                        null
                      );
                    }
                  } else {
                    // No turns manager, emit completion event and add to history
                    if (self.eventEmitter) {
                      self.eventEmitter('messageComplete', { 
                        content: accumulatedContent || '',
                        ...(accumulatedToolCalls.length > 0 && { toolCalls: accumulatedToolCalls })
                      });
                    }
                    
                    self.addAssistantResponseToHistory(
                      accumulatedContent,
                      complianceViolations,
                      accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
                      undefined,
                      null
                    );
                  }
                  
                  // Handle automatic follow-up if next is true
                  if (hasNext) {
                    console.log('[Chat] Auto-sending follow-up request due to next=true (streaming)');
                    self.sendFollowUpRequest();
                  }
                  
                  return; // Exit the generator function
                }

                try {
                  const chunk = JSON.parse(data) as ChatCompletionChunk;
                  yield chunk; // Yield the parsed chunk

                  // Accumulate content and violations for history update
                  const choice = chunk.choices?.[0];
                  if (choice) {
                    const delta = choice.delta;
                    if (delta) {
                        if (delta.content) {
                            if (accumulatedContent === null) accumulatedContent = ""; // Initialize if it was null
                            accumulatedContent += delta.content;
                            
                            // Emit token event for event-driven approach
                            if (self.eventEmitter) {
                              self.eventEmitter('messageTokens', { content: delta.content });
                            }
                            
                            // Periodically emit progress events 
                            if (self.eventEmitter && (accumulatedContent.length % 20 === 0)) {
                              self.eventEmitter('messageProgress', { 
                                content: accumulatedContent,
                                isComplete: false
                              });
                            }
                        }
                        if (delta.tool_calls) {
                            // This is a simplified accumulation.
                            // OpenAI streams tool_calls with an index, e.g., tool_calls[0].id, tool_calls[0].function.name, etc.
                            // A more robust implementation would reconstruct the ToolCall objects piece by piece.
                            // For now, we'll assume each chunk's tool_calls array contains complete or new ToolCall objects.
                            // This might lead to duplicates or partials if not handled carefully by the server's streaming.
                            // A common approach is to receive tool_calls with an index and merge them.
                            // Example: { index: 0, id: "call_abc", function: { name: "get_weather", arguments: "" } }
                            // then later: { index: 0, function: { arguments: "{\"location\":\"SF\"}" } }
                            delta.tool_calls.forEach(tcDelta => {
                                const { index, ...toolCallData } = tcDelta;

                                // Ensure accumulatedToolCalls has an entry for this index
                                while (accumulatedToolCalls.length <= index) {
                                    accumulatedToolCalls.push({
                                        // Initialize with placeholder or default values
                                        id: `temp_id_${accumulatedToolCalls.length}`, // Placeholder, will be overwritten
                                        type: "function", // Default type
                                        function: { name: "", arguments: "" }
                                    });
                                }

                                const targetCall = accumulatedToolCalls[index]!; // Non-null assertion as we just ensured it exists

                                // Merge properties from toolCallData into targetCall
                                if (toolCallData.id) {
                                    targetCall.id = toolCallData.id;
                                }
                                if (toolCallData.type) {
                                    targetCall.type = toolCallData.type;
                                }

                                if (toolCallData.function) {
                                    // Ensure targetCall.function exists
                                    if (!targetCall.function) {
                                        targetCall.function = { name: "", arguments: "" };
                                    }
                                    if (toolCallData.function.name) {
                                        targetCall.function.name = toolCallData.function.name;
                                    }
                                    if (toolCallData.function.arguments) {
                                        // Append arguments as they stream in
                                        targetCall.function.arguments += toolCallData.function.arguments;
                                    }
                                }
                            });
                        }
                        
                        // Accumulate turns and next fields from autoTurn feature
                        if (delta.turns) {
                            accumulatedTurns = delta.turns;
                        }
                        if (delta.next !== undefined) {
                            hasNext = delta.next;
                        }
                        
                        if (choice.finish_reason === 'tool_calls' && accumulatedContent === '') {
                            accumulatedContent = null; // Explicitly set to null if finish_reason is tool_calls and no content
                        }
                    }
                  }
                  
                  // Track compliance violations
                  if (chunk.compliance_violations) {
                    complianceViolations = chunk.compliance_violations;
                    
                    // Emit error event for compliance violations
                    if (self.eventEmitter && complianceViolations.length > 0) {
                      self.eventEmitter('messageError', { 
                        error: `Compliance violations: ${complianceViolations.join(', ')}` 
                      });
                    }
                  }
                } catch (e) {
                  console.error('[Animus SDK] Failed to parse stream chunk:', data, e);
                  // Re-throw error to be caught by the caller iterating the stream
                  throw new Error(`Failed to parse stream chunk: ${e instanceof Error ? e.message : String(e)}`);
                }
              }
            }
          }
        } catch (error) {
          console.error("[Animus SDK] Error processing HTTP stream:", error);
          
          // Try to process with conversational turns first, even in error cases
          if (self.conversationalTurnsManager && accumulatedContent) {
            const wasProcessed = self.conversationalTurnsManager.processResponse(
              accumulatedContent,
              complianceViolations,
              accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
              undefined, // apiTurns - not available in error case
              undefined, // imagePrompt - not supported in streaming yet
              undefined  // hasNext - not available in error case
            );
            
            // If not processed by turns manager, fall back to standard history update
            if (!wasProcessed) {
              self.addAssistantResponseToHistory(
                accumulatedContent,
                complianceViolations,
                accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
                undefined,
                null
              );
            }
          } else {
            // No turns manager or no content, just add to history directly
            self.addAssistantResponseToHistory(
              accumulatedContent,
              complianceViolations,
              accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
              undefined,
              null
            );
          }
          
          // Emit error event
          if (self.eventEmitter) {
            self.eventEmitter('messageError', { 
              error: error instanceof Error ? error : String(error) 
            });
          }
          
          throw error; // Re-throwing allows caller to handle
        } finally {
          reader.releaseLock();
        }
      }

      // Return the async generator function itself
      return processStream();
    } else {
      // Non-streaming case (history update logic remains here)
      console.log('[Animus SDK] Sending NON-STREAMING request payload:', JSON.stringify(payload, null, 2)); // Log payload
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
          request.messages.forEach(msg => this.addMessageToHistory(msg));
          // Add the assistant's response only if no compliance violations
          const assistantMessage = response.choices?.[0]?.message;
          const assistantMessageContent = response.choices?.[0]?.message?.content;
          const assistantReasoning = response.choices?.[0]?.message?.reasoning;
          const assistantToolCalls = response.choices?.[0]?.message?.tool_calls;

          if (assistantMessageContent !== undefined || assistantToolCalls) {
              console.log('[Chat] Non-streaming response, processing with conversational turns');
              console.log('[Chat] Has conversational turns manager:', !!this.conversationalTurnsManager);
              console.log('[Chat] Response content:', assistantMessageContent);
              console.log('[Chat] Response reasoning:', assistantReasoning);
              
              // Extract turns, next, and image prompt from the API response
              const apiTurns = assistantMessage?.turns;
              const hasNext = assistantMessage?.next;
              const imagePrompt = assistantMessage?.image_prompt;
              
              console.log('[Chat] API turns:', apiTurns?.length || 0, 'turns');
              console.log('[Chat] Has next:', hasNext);
              console.log('[Chat] Has image prompt:', !!imagePrompt);
              
              // Try to process with conversational turns first
              const wasProcessed = this.conversationalTurnsManager?.processResponse(
                  assistantMessageContent ?? null,
                  response.compliance_violations,
                  assistantToolCalls,
                  apiTurns, // Pass API-provided turns
                  imagePrompt,
                  hasNext
              );
              
              console.log('[Chat] Conversational turns processed:', wasProcessed);
              
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
                  console.log('[Chat] Using normal processing for non-streaming');
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
                  console.log('[Chat] Auto-sending follow-up request due to next=true');
                  this.sendFollowUpRequest();
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
          console.log('[Animus SDK] Detected image prompt in response:', imagePrompt);
          console.log('[Animus SDK] Image will be generated by client after receiving response');
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
      
      // Cancel any pending conversational turns when a new message is sent
      if (this.conversationalTurnsManager?.isActive()) {
          const canceledCount = this.conversationalTurnsManager.cancelPendingMessages();
          if (canceledCount > 0) {
              console.log(`[Chat] Canceled ${canceledCount} pending conversational turns due to new message`);
          }
      }
      
      // Clear any pending follow-up requests when a new message is sent
      if (this.pendingFollowUpRequest) {
          console.log('[Chat] Clearing pending follow-up request due to new message');
          this.pendingFollowUpRequest = false;
      }
      
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

      // Ensure chat config exists
      if (!this.config || !this.systemMessage) {
          const errorMsg = 'Chat options (model, systemMessage) must be configured in AnimusClient to use chat.send()';
          console.error(errorMsg);
          if (this.eventEmitter) {
              this.eventEmitter('messageError', { error: errorMsg });
          }
          return;
      }
      
      // Add message to history - will be done later in the async function
      // to avoid duplicate messages in the completions payload
      
      // --- Prepare HTTP API Request ---
      const defaults = this.config;
      const requestOptions = options || {};
      const completionRequest: ChatCompletionRequest = {
          messages: [userMessage], // Only the new user message for the API call (history handled by completions)
          model: requestOptions.model ?? defaults.model,
          temperature: requestOptions.temperature ?? defaults.temperature,
          top_p: requestOptions.top_p ?? defaults.top_p,
          n: requestOptions.n ?? defaults.n,
          max_tokens: requestOptions.max_tokens ?? defaults.max_tokens,
          stop: requestOptions.stop ?? defaults.stop,
          presence_penalty: requestOptions.presence_penalty ?? defaults.presence_penalty,
          frequency_penalty: requestOptions.frequency_penalty ?? defaults.frequency_penalty,
          best_of: requestOptions.best_of ?? defaults.best_of,
          top_k: requestOptions.top_k ?? defaults.top_k,
          repetition_penalty: requestOptions.repetition_penalty ?? defaults.repetition_penalty,
          min_p: requestOptions.min_p ?? defaults.min_p,
          length_penalty: requestOptions.length_penalty ?? defaults.length_penalty,
          compliance: requestOptions.compliance ?? defaults.compliance ?? true,
          // Pass through autoTurn from options if provided, else from config
          // Convert to boolean for API - enabled if truthy (boolean true or object with enabled: true)
          autoTurn: this.getAutoTurnEnabled(requestOptions.autoTurn ?? defaults.autoTurn ?? false),
          // Use stream from options/config, but override to false if autoTurn is enabled (backend requirement)
          // For send() method, default to true for backward compatibility unless autoTurn is enabled
          stream: this.getAutoTurnEnabled(requestOptions.autoTurn ?? defaults.autoTurn ?? false) ? false : (requestOptions.stream ?? true),
          // Pass through tools from options if provided, else from config
          tools: requestOptions.tools ?? defaults.tools,
          // Pass through check_image_generation
          check_image_generation: requestOptions.check_image_generation,
      };
      
      // Store request parameters for follow-up requests (excluding messages)
      this.lastRequestParameters = { ...completionRequest };
      delete this.lastRequestParameters.messages; // Don't store messages as they'll be rebuilt
      
      // Remove undefined values
      Object.keys(completionRequest).forEach(key => {
          if ((completionRequest as any)[key] === undefined) {
              delete (completionRequest as any)[key];
          }
      });
      
      const reasoningEnabled = 'reasoning' in requestOptions ? requestOptions.reasoning : defaults.reasoning;
      if (reasoningEnabled) {
          (completionRequest as Record<string, any>).reasoning = true;
          (completionRequest as Record<string, any>).show_reasoning = true;
      }
      
      // Process the completion in a non-blocking way using async IIFE
      (async () => {
          try {
              // Prepare request with system message and history
              const messagesToSend = [this.systemMessage!]; // Non-null assertion (we checked above)
              
              // Add history if applicable
              const historySize = this.config?.historySize ?? 0;
              if (historySize > 0 && this.chatHistory.length > 0) {
                  // Calculate available slots for history
                  const availableSlots = historySize - 1; // Reserve one slot for the new user message
                  if (availableSlots > 0) {
                      const historyCount = Math.min(this.chatHistory.length, availableSlots);
                      const historyMessages = this.chatHistory.slice(-historyCount);
                      
                      // Reconstruct grouped messages for API requests
                      const reconstructedHistory = this.reconstructGroupedMessages(historyMessages);
                      messagesToSend.push(...reconstructedHistory);
                  }
              }
              
              // Add the user message
              messagesToSend.push(userMessage);
              
              // Update the messages in the request
              completionRequest.messages = messagesToSend;
              
              // NOW add the message to history AFTER we've prepared the API request
              // This avoids duplicate messages in the completions payload
              // Skip adding [CONTINUE] messages to history
              if (userMessage.content !== '[CONTINUE]') {
                  this.addMessageToHistory(userMessage);
              } else {
                  console.log('[Chat] Skipping [CONTINUE] message from history');
              }
              
              // Make the API request directly (don't use completions to avoid Promise return)
              console.log('[Animus SDK] Sending event-driven request');
              const isStreaming = completionRequest.stream ?? false;
              const response = isStreaming
                  ? await this.requestUtil.request('POST', '/chat/completions', completionRequest, true)
                  : await this.requestUtil.request('POST', '/chat/completions', completionRequest, false);
              
              if (isStreaming) {
                  // Handle streaming response
                  if (!response.body) {
                      throw new Error('Streaming response body is null');
                  }
                  
                  // Process the stream and emit events
                  const reader = response.body.getReader();
                  const decoder = new TextDecoder();
                  let accumulatedContent: string | null = '';
                  let accumulatedToolCalls: ToolCall[] = [];
                  let complianceViolations: string[] | undefined;
                  let accumulatedTurns: string[] | undefined;
                  let hasNext: boolean | undefined;
                  let buffer = '';
              
              try {
                  while (true) {
                      const { done, value } = await reader.read();
                      if (done) {
                          // Stream ended without [DONE] marker
                          if (accumulatedContent || accumulatedToolCalls.length > 0) {
                              // Emit final message complete event
                              if (this.eventEmitter) {
                                  this.eventEmitter('messageComplete', {
                                      content: accumulatedContent || '', 
                                      ...(accumulatedToolCalls.length > 0 && { toolCalls: accumulatedToolCalls })
                                  });
                              }
                              
                              // Add to history if not already processed by turns manager
                              this.addAssistantResponseToHistory(
                                  accumulatedContent,
                                  complianceViolations,
                                  accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
                                  undefined,
                                  null
                              );
                          }
                          break;
                      }
                      
                      buffer += decoder.decode(value, { stream: true });
                      const lines = buffer.split('\n');
                      buffer = lines.pop() || '';
                      
                      for (const line of lines) {
                          if (line.trim() === '') continue;
                          
                          if (line.startsWith('data: ')) {
                              const data = line.substring(6).trim();
                              if (data === '[DONE]') {
                                  // Stream complete
                                  // Try conversational turns first
                                  if (this.conversationalTurnsManager) {
                                      console.log('[Chat] Stream complete, attempting to process with conversational turns');
                                      const wasProcessed = this.conversationalTurnsManager.processResponse(
                                          accumulatedContent,
                                          complianceViolations,
                                          accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
                                          accumulatedTurns,
                                          undefined, // imagePrompt - not supported in streaming yet
                                          hasNext
                                      );
                                      
                                      console.log('[Chat] Was processed by conversational turns:', wasProcessed);
                                      
                                      // Always emit messageComplete regardless of whether it was processed by turns
                                      if (this.eventEmitter) {
                                          this.eventEmitter('messageComplete', {
                                              content: accumulatedContent || '',
                                              ...(accumulatedToolCalls.length > 0 && { toolCalls: accumulatedToolCalls })
                                          });
                                      }
                                      
                                      // Only add to history directly if not processed by turns manager
                                      if (!wasProcessed) {
                                          
                                          this.addAssistantResponseToHistory(
                                              accumulatedContent,
                                              complianceViolations,
                                              accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
                                              undefined,
                                              null
                                          );
                                      }
                                  } else {
                                      // No conversational turns manager
                                      if (this.eventEmitter) {
                                          this.eventEmitter('messageComplete', {
                                              content: accumulatedContent || '',
                                              ...(accumulatedToolCalls.length > 0 && { toolCalls: accumulatedToolCalls })
                                          });
                                      }
                                      
                                      this.addAssistantResponseToHistory(
                                          accumulatedContent,
                                          complianceViolations,
                                          accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
                                          undefined,
                                          null
                                      );
                                  }
                                  
                                  // Handle automatic follow-up if next is true
                                  if (hasNext) {
                                      console.log('[Chat] Auto-sending follow-up request due to next=true (send method)');
                                      this.sendFollowUpRequest();
                                  }
                                  
                                  return;
                              }
                              
                              try {
                                  const chunk = JSON.parse(data) as ChatCompletionChunk;
                                  const choice = chunk.choices?.[0];
                                  
                                  if (choice) {
                                      const delta = choice.delta;
                                      
                                      if (delta) {
                                          if (delta.content) {
                                              if (accumulatedContent === null) accumulatedContent = "";
                                              accumulatedContent += delta.content;
                                              
                                              // Emit token event
                                              if (this.eventEmitter) {
                                                  this.eventEmitter('messageTokens', { content: delta.content });
                                              }
                                              
                                              // Emit progress periodically
                                              if (this.eventEmitter && accumulatedContent.length % 20 === 0) {
                                                  this.eventEmitter('messageProgress', {
                                                      content: accumulatedContent,
                                                      isComplete: false
                                                  });
                                              }
                                          }
                                          
                                          if (delta.tool_calls) {
                                              delta.tool_calls.forEach(tcDelta => {
                                                  const { index, ...toolCallData } = tcDelta;
                                                  
                                                  while (accumulatedToolCalls.length <= index) {
                                                      accumulatedToolCalls.push({
                                                          id: `temp_id_${accumulatedToolCalls.length}`,
                                                          type: "function",
                                                          function: { name: "", arguments: "" }
                                                      });
                                                  }
                                                  
                                                  const targetCall = accumulatedToolCalls[index]!;
                                                  
                                                  if (toolCallData.id) {
                                                      targetCall.id = toolCallData.id;
                                                  }
                                                  if (toolCallData.type) {
                                                      targetCall.type = toolCallData.type;
                                                  }
                                                  
                                                  if (toolCallData.function) {
                                                      if (!targetCall.function) {
                                                          targetCall.function = { name: "", arguments: "" };
                                                      }
                                                      if (toolCallData.function.name) {
                                                          targetCall.function.name = toolCallData.function.name;
                                                      }
                                                      if (toolCallData.function.arguments) {
                                                          targetCall.function.arguments += toolCallData.function.arguments;
                                                      }
                                                  }
                                              });
                                          }
                                          
                                          // Accumulate turns and next fields from autoTurn feature
                                          if (delta.turns) {
                                              accumulatedTurns = delta.turns;
                                          }
                                          if (delta.next !== undefined) {
                                              hasNext = delta.next;
                                          }
                                      }
                                  }
                                  
                                  // Check for compliance violations
                                  if (chunk.compliance_violations) {
                                      complianceViolations = chunk.compliance_violations;
                                      
                                      if (this.eventEmitter && complianceViolations.length > 0) {
                                          this.eventEmitter('messageError', { 
                                              error: `Compliance violations: ${complianceViolations.join(', ')}`
                                          });
                                      }
                                  }
                              } catch (e) {
                                  console.error('[Animus SDK] Failed to parse stream chunk:', data, e);
                                  if (this.eventEmitter) {
                                      this.eventEmitter('messageError', { 
                                          error: `Failed to parse stream chunk: ${e instanceof Error ? e.message : String(e)}`
                                      });
                                  }
                              }
                          }
                      }
                  }
              } catch (error) {
                  console.error('[Animus SDK] Error processing stream:', error);
                  
                  // Emit error event
                  if (this.eventEmitter) {
                      this.eventEmitter('messageError', { 
                          error: error instanceof Error ? error : String(error)
                      });
                  }
              } finally {
                  reader.releaseLock();
              }
              } else {
                  // Handle non-streaming response (for autoTurn)
                  // RequestUtil already parsed the JSON for non-streaming requests
                  const jsonResponse = response as ChatCompletionResponse;
                  
                  console.log('[Chat] Non-streaming response, processing with conversational turns');
                  console.log('[Chat] Has conversational turns manager:', !!this.conversationalTurnsManager);
                  
                  const choice = jsonResponse.choices?.[0];
                  if (choice?.message) {
                      const message = choice.message;
                      const content = message.content;
                      const reasoning = message.reasoning;
                      const toolCalls = message.tool_calls;
                      const turns = message.turns;
                      const next = message.next;
                      const imagePrompt = message.image_prompt;
                      
                      console.log('[Chat] Response content:', content);
                      console.log('[Chat] Response reasoning:', reasoning);
                      console.log('[Chat] API turns:', turns?.length || 0, 'turns');
                      console.log('[Chat] Has next:', next);
                      console.log('[Chat] Has image prompt:', !!imagePrompt);
                      
                      // Handle conversational turns if available
                      let turnsProcessed = false;
                      if (this.conversationalTurnsManager && turns && turns.length > 0) {
                          console.log('[ConversationalTurns] Using API-provided turns:', turns.length, 'turns');
                          turnsProcessed = this.conversationalTurnsManager.processResponse(
                              content,
                              jsonResponse.compliance_violations,
                              toolCalls,
                              turns,
                              imagePrompt,
                              next
                          );
                      }
                      
                      console.log('[Chat] Conversational turns processed:', turnsProcessed);
                      
                      if (!turnsProcessed) {
                          console.log('[Chat] Using normal processing for non-streaming');
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
                          console.log('[Chat] Generating image immediately (no turns processed)');
                          this.generateImageAndHandleNext(imagePrompt, next);
                      } else if (next && !turnsProcessed) {
                          // Only handle follow-up immediately if turns were NOT processed
                          if (turnsProcessed) {
                              // If turns were processed, store the follow-up request for later
                              console.log('[Chat] Storing follow-up request for after turns complete');
                              this.pendingFollowUpRequest = true;
                          } else {
                              // Handle follow-up immediately if no turns were processed
                              console.log('[Chat] Sending follow-up request immediately (no turns, no image)');
                              this.sendFollowUpRequest();
                          }
                      }
                  }
              }
              
          } catch (error) {
              console.error("[Animus SDK] Error in event-driven send:", error);
              
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
   * Helper function to update history consistently.
   * Cleans <think> tags from assistant messages before adding.
   * Kept private as it's called internally by finalizeAssistantResponse or non-streaming completions.
   */
  private addMessageToHistory(message: ChatMessage | null): void {
      // Skip null/undefined messages or in no-history mode
      if (!message || !this.config || !this.config.historySize || this.config.historySize <= 0) return;
      
      // Skip continuation messages from being added to history
      if (message.role === 'user' && message.content === '[CONTINUE]') {
          console.log("[Animus SDK] Skipping continuation message from history");
          return;
      }
  
      // Ensure message has a timestamp
      if (!message.timestamp) {
          message.timestamp = new Date().toISOString();
      }

      const historySize = this.config.historySize;

      // Deep clone to avoid external mutations
      const messageToAdd = { ...message };

      if (messageToAdd.role === 'assistant') {
          let finalContent = messageToAdd.content || ''; // content can be null
          let reasoning: string | undefined = undefined;
          const toolCalls = messageToAdd.tool_calls; // Preserve tool_calls

          // Reasoning extraction only applies if there's content
          if (finalContent) {
              // Extract reasoning from <think></think> blocks if present
              const thinkRegex = /<think>([\s\S]*?)<\/think>/; // Matches first <think>...</think> block
              const match = finalContent.match(thinkRegex); // Match on the original content

              if (match && match[0] && match[1]) {
                  // Found a think block
                  reasoning = match[1].trim(); // Extract content inside tags
                  // Construct the cleaned content by removing the matched block
                  finalContent = finalContent.replace(match[0], '').trim();
                  // Fix any double spaces that might occur when removing the block
                  finalContent = finalContent.replace(/\s{2,}/g, ' ');
                  // console.log("[Animus SDK] Extracted reasoning:", reasoning); // Keep commented out for now
              } else {
                  // No think block found, just trim whitespace from original content
                  finalContent = finalContent.trim();
              }
          }
          // Update messageToAdd with cleaned content and reasoning
          messageToAdd.content = finalContent || null; // Ensure it's null if empty after processing
          if (reasoning) {
              messageToAdd.reasoning = reasoning;
          }
          if (toolCalls) { // Ensure tool_calls are carried over
              messageToAdd.tool_calls = toolCalls;
          }

          // Only push if there's actual visible content OR if reasoning was extracted OR if there are tool_calls
          if (!finalContent && !reasoning && (!toolCalls || toolCalls.length === 0)) {
               console.log("[Animus SDK] Assistant message had no visible content, reasoning, or tool_calls after processing, not adding to history.");
               return; // Don't add empty/whitespace-only assistant messages without reasoning or tool_calls
          }
      } else if (messageToAdd.role === 'tool') {
        // For tool messages, content is required (the result of the tool call)
        // and tool_call_id is required.
        if (!messageToAdd.content || !messageToAdd.tool_call_id) {
            console.warn("[Animus SDK] Tool message is missing content or tool_call_id, not adding to history.", messageToAdd);
            return;
        }
        // No further processing needed for tool messages, just ensure they are added.
      }


      // Add the processed message (user or cleaned assistant) to history
      this.chatHistory.push(messageToAdd);

      // Trim history
      if (this.chatHistory.length > historySize) {
          this.chatHistory = this.chatHistory.slice(-historySize);
      }
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
       // If compliance violations exist, log but still add to history for context
       // The conversation needs context even if content has violations
       if (compliance_violations && compliance_violations.length > 0) {
           console.warn(`[Animus SDK] Assistant response has compliance violations but adding to history for context: ${compliance_violations.join(', ')}`);
       }

       // Don't add empty responses if there's no content AND no tool_calls
       if (assistantContent === null && (!tool_calls || tool_calls.length === 0)) {
           console.log("[Animus SDK] Assistant response has no content and no tool_calls, not adding to history.");
           return;
       }


       // Use processedTimestamp from group metadata if available (for conversational turns),
       // otherwise use current timestamp
       const timestamp = groupMetadata?.processedTimestamp
           ? new Date(groupMetadata.processedTimestamp).toISOString()
           : new Date().toISOString();
           
       const assistantMessage: ChatMessage = {
           role: 'assistant',
           content: assistantContent, // Will be null if no text content
           timestamp: timestamp,
           ...(reasoning && { reasoning: reasoning }), // Add reasoning if provided
           ...(tool_calls && tool_calls.length > 0 && { tool_calls: tool_calls }),
           ...(compliance_violations && compliance_violations.length > 0 && { compliance_violations }),
           // Add group metadata if provided
           ...(groupMetadata?.groupId && {
               groupId: groupMetadata.groupId,
               messageIndex: groupMetadata.messageIndex,
               totalInGroup: groupMetadata.totalInGroup
           })
       };
       this.addMessageToHistory(assistantMessage);
       
   }

   /**
    * Returns a copy of the current chat history.
    * @returns A copy of the chat history array
    */
   public getChatHistory(): ChatMessage[] {
       // Return a deep copy to prevent external mutations
       return JSON.parse(JSON.stringify(this.chatHistory));
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
       // Skip operation if history is not enabled
       if (!this.config?.historySize || this.config.historySize <= 0) {
           console.warn('[Animus SDK] Cannot set chat history when history is disabled (historySize <= 0)');
           return 0;
       }

       if (!Array.isArray(history)) {
           console.error('[Animus SDK] Invalid history format: expected an array');
           return 0;
       }

       // Clear the existing history
       this.chatHistory = [];
       
       // Validate and add each message if validation is enabled
       if (validate) {
           // Filter valid messages only and add them individually (allows processing/cleaning)
           const validMessages = history.filter(msg =>
               msg &&
               typeof msg === 'object' &&
               (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool') &&
               (typeof msg.content === 'string' || msg.content === null) && // content can be null
               // Basic validation for tool messages
               (msg.role !== 'tool' || (typeof msg.content === 'string' && msg.tool_call_id)) &&
               // Basic validation for assistant tool_calls
               (msg.role !== 'assistant' || !msg.tool_calls || (Array.isArray(msg.tool_calls) && msg.tool_calls.every(tc => tc.id && tc.type === 'function' && tc.function?.name && typeof tc.function?.arguments === 'string')))
           );
           
           validMessages.forEach(msg => this.addMessageToHistory({ ...msg })); // addMessageToHistory will handle further processing
           return this.chatHistory.length;
       } else {
           // Fast path: just copy the array directly (no validation/processing)
           // Still ensure we respect the history size limit
           this.chatHistory = history.slice(-this.config.historySize);
           return this.chatHistory.length;
       }
   }

   /**
    * Updates a specific message in the chat history by index.
    *
    * @param index - The index of the message to update
    * @param updatedMessage - The new message content or partial update
    * @returns boolean indicating success
    */
   public updateHistoryMessage(index: number, updatedMessage: Partial<ChatMessage>): boolean {
       // Skip operation if history is not enabled
       if (!this.config?.historySize || this.config.historySize <= 0) {
           console.warn('[Animus SDK] Cannot update history message when history is disabled (historySize <= 0)');
           return false;
       }

       // Check if index is valid
       if (index < 0 || index >= this.chatHistory.length) {
           console.error(`[Animus SDK] Invalid index: ${index}. History length is ${this.chatHistory.length}`);
           return false;
       }

       // Since we already validated the index, we can safely get the message
       // We use a non-null assertion (!) here since we already checked index validity
       const currentMessage = this.chatHistory[index]!;

       // Allow updating user, assistant, or tool messages (not system)
       if (currentMessage.role !== 'user' && currentMessage.role !== 'assistant' && currentMessage.role !== 'tool') {
           console.error(`[Animus SDK] Cannot update message with role: ${currentMessage.role}`);
           return false;
       }

       // Only allow updating to valid roles (user, assistant, or tool)
       const validUpdateRoles: ChatMessage['role'][] = ['user', 'assistant', 'tool'];
       if (updatedMessage.role && !validUpdateRoles.includes(updatedMessage.role)) {
           console.error(`[Animus SDK] Cannot update message to invalid role: ${updatedMessage.role}`);
           return false;
       }

       // Apply the update - safely using non-null assertion since index was validated
       const originalMessage = this.chatHistory[index]!;
       
       // Create a properly typed merge that guarantees the required properties
       const newMessage: ChatMessage = {
           role: originalMessage.role, // Keep original role unless explicitly updated
           content: originalMessage.content, // Keep original content unless explicitly updated
           name: originalMessage.name,
           reasoning: originalMessage.reasoning,
           tool_calls: originalMessage.tool_calls,
           tool_call_id: originalMessage.tool_call_id,
           timestamp: originalMessage.timestamp || new Date().toISOString() // Ensure timestamp
       };
       
       // Apply updates
       if (updatedMessage.role) {
           newMessage.role = updatedMessage.role;
       }
       if (updatedMessage.content !== undefined) { // Allows setting content to null
           newMessage.content = updatedMessage.content;
       }
       if (updatedMessage.name !== undefined) {
           newMessage.name = updatedMessage.name;
       }
       if (updatedMessage.reasoning !== undefined) {
           newMessage.reasoning = updatedMessage.reasoning;
       }
       if (updatedMessage.tool_calls !== undefined) {
           newMessage.tool_calls = updatedMessage.tool_calls;
       }
       if (updatedMessage.tool_call_id !== undefined) {
           newMessage.tool_call_id = updatedMessage.tool_call_id;
       }
       if (updatedMessage.timestamp !== undefined) {
           newMessage.timestamp = updatedMessage.timestamp;
       }


       // If updating assistant message content, process thoughts
       if (newMessage.role === 'assistant' && updatedMessage.content !== undefined && typeof newMessage.content === 'string') {
           let finalContent = newMessage.content || ''; // Ensure it's a string for regex
           let reasoning: string | undefined = undefined;

           const thinkRegex = /<think>([\s\S]*?)<\/think>/;
           const match = finalContent.match(thinkRegex);

           if (match && match[0] && match[1]) {
               reasoning = match[1].trim();
               finalContent = finalContent.replace(match[0], '').trim().replace(/\s{2,}/g, ' ');
           } else {
               finalContent = finalContent.trim();
           }
           newMessage.content = finalContent || null; // Set to null if empty after processing
           if (reasoning) newMessage.reasoning = reasoning;
           else if (updatedMessage.reasoning === undefined) delete newMessage.reasoning; // Clear reasoning if not in update and removed by processing
       }

       // Validate tool message requirements if role is changed to 'tool' or content/id is updated
       if (newMessage.role === 'tool') {
           if (typeof newMessage.content !== 'string' || !newMessage.content.trim() || !newMessage.tool_call_id) {
               console.error('[Animus SDK] Invalid tool message update: content must be non-empty string and tool_call_id is required.', newMessage);
               return false;
           }
       }

       // Validate assistant message with tool_calls
       if (newMessage.role === 'assistant' && newMessage.tool_calls && newMessage.tool_calls.length > 0 && newMessage.content !== null) {
           // As per OpenAI spec, if tool_calls is present, content should be null.
           // However, some models might return content alongside tool_calls (e.g. for thought process).
           // We will allow content here but log a warning if it's not best practice.
           // console.warn("[Animus SDK] Assistant message has both tool_calls and content. While allowed, standard practice is for content to be null when tool_calls are present.");
       }


       // Update the history
       this.chatHistory[index] = newMessage;
       return true;
   }

   /**
    * Deletes a specific message from the chat history by index.
    *
    * @param index - The index of the message to delete
    * @returns boolean indicating success
    */
   public deleteHistoryMessage(index: number): boolean {
       // Skip operation if history is not enabled
       if (!this.config?.historySize || this.config.historySize <= 0) {
           console.warn('[Animus SDK] Cannot delete history message when history is disabled (historySize <= 0)');
           return false;
       }

       // Check if index is valid
       if (index < 0 || index >= this.chatHistory.length) {
           console.error(`[Animus SDK] Invalid index: ${index}. History length is ${this.chatHistory.length}`);
           return false;
       }

       // Remove the message
       this.chatHistory.splice(index, 1);
       return true;
   }
   
   /**
    * Cancels any pending conversational turns
    * @returns The number of turns that were canceled
    */
   public cancelPendingTurns(): number {
       if (!this.conversationalTurnsManager) {
           console.log('[Chat] No conversational turns manager available, nothing to cancel');
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
       const count = this.chatHistory.length;
       this.chatHistory = [];
       return count;
   }

   
   /**
    * Reconstructs grouped messages back into their original form for API requests
    * @param messages Array of messages that may contain grouped messages
    * @returns Array of messages with grouped messages reconstructed
    */
   private reconstructGroupedMessages(messages: ChatMessage[]): ChatMessage[] {
       const result: ChatMessage[] = [];
       const groupMap = new Map<string, ChatMessage[]>();
       
       // First pass: collect grouped messages
       for (const message of messages) {
           if (message.groupId && message.messageIndex !== undefined && message.totalInGroup !== undefined) {
               if (!groupMap.has(message.groupId)) {
                   groupMap.set(message.groupId, []);
               }
               groupMap.get(message.groupId)!.push(message);
           } else {
               // Non-grouped message, add directly
               result.push(message);
           }
       }
       
       // Second pass: reconstruct grouped messages
       for (const [groupId, groupMessages] of groupMap.entries()) {
           // Sort by messageIndex to ensure correct order
           groupMessages.sort((a, b) => (a.messageIndex || 0) - (b.messageIndex || 0));
           
           // Create a single reconstructed message from the group
           const firstMessage = groupMessages[0];
           if (!firstMessage) continue; // Skip if no messages in group
           
           const reconstructedContent = groupMessages.map(msg => msg.content).join(' ');
           const lastMessage = groupMessages[groupMessages.length - 1];
           
           const reconstructedMessage: ChatMessage = {
               role: firstMessage.role,
               content: reconstructedContent,
               timestamp: firstMessage.timestamp,
               // Include other properties from the first message but remove group metadata
               ...(firstMessage.name && { name: firstMessage.name }),
               ...(firstMessage.reasoning && { reasoning: firstMessage.reasoning }),
               // Include compliance violations from the last message (as they apply to the full response)
               ...(lastMessage?.compliance_violations && {
                   compliance_violations: lastMessage.compliance_violations
               }),
               // Only include tool_calls from the last message in the group (as per original logic)
               ...(lastMessage?.tool_calls && {
                   tool_calls: lastMessage.tool_calls
               })
           };
           
           result.push(reconstructedMessage);
       }
       
       return result;
   }
   
   /**
    * Handle post-response actions (image generation and follow-up) when no conversational turns are involved
    * @param imagePrompt Optional image prompt to generate
    * @param next Whether to send a follow-up request
    */
   private handlePostResponseActions(imagePrompt?: string, next?: boolean): void {
       if (imagePrompt) {
           console.log('[Chat] Generating image immediately (no turns)');
           this.generateImageAndHandleNext(imagePrompt, next);
       } else if (next) {
           console.log('[Chat] Sending follow-up request immediately (no turns, no image)');
           this.sendFollowUpRequest();
       }
   }


   /**
    * Generate an image and handle follow-up request after completion
    * @param imagePrompt The image prompt to generate
    * @param next Whether to send a follow-up request after image generation
    */
   private generateImageAndHandleNext(imagePrompt: string, next?: boolean): void {
       console.log('[Chat] Starting image generation for prompt:', imagePrompt);
       
       // Emit image generation start event
       if (this.eventEmitter) {
           this.eventEmitter('imageGenerationStart', {
               prompt: imagePrompt
           });
       }

       // If we have access to the generateImage method, use it and wait for completion
       if (this.generateImage) {
           this.generateImage(imagePrompt)
               .then((imageUrl: string) => {
                   console.log('[Chat] Image generation completed:', imageUrl);
                   
                   // Emit image generation complete event
                   if (this.eventEmitter) {
                       this.eventEmitter('imageGenerationComplete', {
                           prompt: imagePrompt,
                           imageUrl: imageUrl
                       });
                   }
                   
                   if (next) {
                       console.log('[Chat] Sending follow-up request after image completion');
                       this.sendFollowUpRequest();
                   }
               })
               .catch((error: any) => {
                   console.error('[Chat] Image generation failed:', error);
                   
                   // Emit image generation error event
                   if (this.eventEmitter) {
                       this.eventEmitter('imageGenerationError', {
                           prompt: imagePrompt,
                           error: error
                       });
                   }
                   
                   if (next) {
                       console.log('[Chat] Sending follow-up request despite image failure');
                       this.sendFollowUpRequest();
                   }
               });
       } else {
           // If no image generation method available, emit error and handle follow-up
           console.log('[Chat] No image generation method available');
           
           if (this.eventEmitter) {
               this.eventEmitter('imageGenerationError', {
                   prompt: imagePrompt,
                   error: 'Image generation method not available'
               });
           }
           
           if (next) {
               // Add a delay to allow UI to handle the error
               setTimeout(() => {
                   console.log('[Chat] Sending follow-up request after image generation unavailable');
                   this.sendFollowUpRequest();
               }, 1000); // 1 second delay
           }
       }
   }

   /**
    * Send an automatic follow-up request when the API indicates more content is expected
    * This is called when the response has next=true
    */
   private sendFollowUpRequest(): void {
       // Use a short delay to make the follow-up feel natural
       setTimeout(() => {
           console.log('[Chat] Sending automatic follow-up request');
           this.makeFollowUpApiRequest();
       }, 1000); // 1 second delay to feel natural
   }

   /**
    * Make a follow-up API request without adding any user message
    * This continues the conversation naturally with the existing history
    */
   private async makeFollowUpApiRequest(): Promise<void> {
       try {
           console.log('[Chat] Making follow-up API request with current history');
           
           // Prepare the API request with current history (no new user message)
           const messagesToSend = [this.systemMessage!];
           
           // Add history if applicable
           const historySize = this.config?.historySize ?? 0;
           if (historySize > 0 && this.chatHistory.length > 0) {
               const historyCount = Math.min(this.chatHistory.length, historySize);
               const historyMessages = this.chatHistory.slice(-historyCount);
               const reconstructedHistory = this.reconstructGroupedMessages(historyMessages);
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
           
           console.log('[Chat] Follow-up API request prepared');
           
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
           const jsonResponse = response as any;
           
           console.log('[Chat] Follow-up response received');
           
           // Process the response the same way as normal responses
           const choice = jsonResponse.choices?.[0];
           if (choice?.message) {
               const message = choice.message;
               const content = message.content;
               const toolCalls = message.tool_calls;
               const turns = message.turns;
               const next = message.next;
               const imagePrompt = message.image_prompt;
               
               console.log('[Chat] Follow-up response content:', content);
               console.log('[Chat] Follow-up API turns:', turns?.length || 0, 'turns');
               console.log('[Chat] Follow-up has next:', next);
               console.log('[Chat] Follow-up has image prompt:', !!imagePrompt);
               
               // Handle conversational turns if available
               let turnsProcessed = false;
               if (this.conversationalTurnsManager && turns && turns.length > 0) {
                   console.log('[ConversationalTurns] Processing follow-up turns:', turns.length, 'turns');
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
                   console.log('[Chat] Using normal processing for follow-up');
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
                   console.log('[Chat] Generating image immediately (follow-up, no turns processed)');
                   this.generateImageAndHandleNext(imagePrompt, next);
               } else if (next && !turnsProcessed) {
                   // Only handle follow-up immediately if turns were NOT processed
                   if (turnsProcessed) {
                       // If turns were processed, store the follow-up request for later
                       console.log('[Chat] Storing follow-up request for after turns complete (follow-up)');
                       this.pendingFollowUpRequest = true;
                   } else {
                       // Handle follow-up immediately if no turns were processed
                       console.log('[Chat] Sending follow-up request immediately (follow-up, no turns, no image)');
                       this.sendFollowUpRequest();
                   }
               }
           }
           
       } catch (error) {
           console.error('[Chat] Error in follow-up request:', error);
           if (this.eventEmitter) {
               this.eventEmitter('messageError', {
                   error: error instanceof Error ? error.message : String(error)
               });
           }
       }
   }
}