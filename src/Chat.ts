import { RequestUtil, ApiError } from './RequestUtil';
import type { AnimusChatOptions } from './AnimusClient'; // Import the new type
// --- Interfaces based on API Documentation ---

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string; // Optional name for user/assistant roles
  reasoning?: string; // Optional field to store extracted <think> content
}

// Keep all optional fields as optional in the request interface
export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model?: string;
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
}

// --- Response Interfaces (remain the same) ---

interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
  };
  finish_reason: string; // e.g., 'stop', 'length'
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
  content?: string;
}

interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkChoiceDelta;
  finish_reason: string | null;
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

  // Observer integration functions (passed from AnimusClient)
  private isObserverConnected: () => boolean;
  private sendObserverText: (text: string) => Promise<void>;
  constructor(
      requestUtil: RequestUtil,
      chatOptions: AnimusChatOptions | undefined, // Receive the whole config object or undefined
      // Add observer functions to constructor
      isObserverConnected: () => boolean,
      sendObserverText: (text: string) => Promise<void>
      // Removed eventEmitter parameter
  ) {
    this.requestUtil = requestUtil;
    this.config = chatOptions;
    // Removed eventEmitter storage

    // Store observer functions
    this.isObserverConnected = isObserverConnected;
    this.sendObserverText = sendObserverText;

    // Set system message if config is provided
     if (this.config?.systemMessage) {
         this.systemMessage = { role: 'system', content: this.config.systemMessage };
     }
     // Note: Model check happens within completions/send if needed
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
    };

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
           const relevantHistory = this.chatHistory.slice(-historyCount)
               // Map history to exclude the 'reasoning' field before sending
               .map(({ role, content, name }) => ({ role, content, ...(name && { name }) }));
            messagesToSend.push(...relevantHistory);
        }
    }

    // Add the new messages from the request
    messagesToSend.push(...request.messages);

    payload.messages = messagesToSend; // Update payload
    // --- End System Message & History Management ---


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
        let accumulatedContent = '';
        let complianceViolations: string[] | undefined;
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
                  // History update happens *after* the generator finishes
                  self.addAssistantResponseToHistory(accumulatedContent, complianceViolations);
                  return; // Exit the generator function
                }

                try {
                  const chunk = JSON.parse(data) as ChatCompletionChunk;
                  yield chunk; // Yield the parsed chunk

                  // Accumulate content and violations for history update
                  const deltaContent = chunk.choices?.[0]?.delta?.content;
                  if (deltaContent) {
                    accumulatedContent += deltaContent;
                  }
                  // Compliance violations are not sent in streaming chunks per updated docs
                  // if (chunk.compliance_violations) {
                  //   complianceViolations = chunk.compliance_violations;
                  //   console.log(`[Animus SDK] Compliance violations detected:`, complianceViolations);
                  // }
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
          // Add potentially partial content to history on error before re-throwing
          self.addAssistantResponseToHistory(accumulatedContent, complianceViolations);
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
         if (assistantMessage) {
             // Use addAssistantResponseToHistory to handle cleaning/trimming and check compliance
             this.addAssistantResponseToHistory(assistantMessage.content, response.compliance_violations);
         }
         // Trimming is handled within addMessageToHistory
     }
      // --- End History Update ---
      return response;
    }
  }

  /**
   * Sends a single user message and gets a response, automatically handling
   * history and the configured system message.
   * Sends a single user message. If the Observer is connected, it sends the message
   * via the LiveKit data channel. Otherwise, it sends the message via the standard
   * Animus API HTTP request and returns the completion response.
   *
   * @param messageContent - The content of the user's message.
   * @param options - Optional: Overrides for completion parameters (model, temperature, etc.)
   *                  when falling back to the HTTP API. Cannot override `messages` or `stream`.
   * @returns A Promise resolving to `void` if sent via Observer, or `ChatCompletionResponse` if sent via HTTP API.
   */
  // Return type matches completions now
  // Allow 'stream' override in options
  public async send(
      messageContent: string,
      options?: Omit<ChatCompletionRequest, 'messages' | 'model'> & { model?: string } // Removed 'stream' from Omit
  ): Promise<ChatCompletionResponse | AsyncIterable<ChatCompletionChunk>> {

      const userMessage: ChatMessage = { role: 'user', content: messageContent };

      // Ensure chat config exists (needed for both paths now)
      if (!this.config || !this.systemMessage) {
          throw new Error('Chat options (model, systemMessage) must be configured in AnimusClient to use chat.send().');
      }

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
          // Use stream from options if provided, otherwise use config default
          stream: options?.stream ?? defaults.stream ?? false,
      };
      // Remove undefined values
      Object.keys(completionRequest).forEach(key => {
          if ((completionRequest as any)[key] === undefined) {
              delete (completionRequest as any)[key];
          }
      });
      // --- End Prepare HTTP API Request ---


      // --- Prepare Observer Payload (if connected) ---
      let observerPayloadString: string | null = null;
      if (this.isObserverConnected()) {
          const historySize = this.config.historySize ?? 0;
          let observerMessages: ChatMessage[] = [this.systemMessage];
          if (historySize > 0 && this.chatHistory.length > 0) {
              const historyCountToFetch = Math.min(this.chatHistory.length, historySize);
              if (historyCountToFetch > 0) {
                  const relevantHistory = this.chatHistory.slice(-historyCountToFetch)
                      .map(({ role, content, name }) => ({ role, content, ...(name && { name }) }));
                  observerMessages.push(...relevantHistory);
              }
          }
          observerMessages.push(userMessage); // Add new user message

          const observerLlmParams: Record<string, any> = {
              model: this.config.model,
              temperature: this.config.temperature,
              max_completion_tokens: this.config.max_tokens,
              top_p: this.config.top_p,
              stop: this.config.stop,
              // Add other relevant params from config
          };
          Object.keys(observerLlmParams).forEach(key => {
              if (observerLlmParams[key] === undefined) {
                  delete observerLlmParams[key];
              }
          });

          const observerPayload: Record<string, any> = { messages: observerMessages };
          if (Object.keys(observerLlmParams).length > 0) {
              observerPayload.llm_params = observerLlmParams;
          }
          observerPayloadString = JSON.stringify(observerPayload);
      }
      // --- End Prepare Observer Payload ---


      // --- Execute Sends ---
      // 1. Send to Observer (fire-and-forget, errors logged internally by sendObserverText)
      if (observerPayloadString) {
          console.log('[Animus SDK] Sending OBSERVER payload (parallel):', observerPayloadString);
          this.sendObserverText(observerPayloadString).catch(error => {
              // Error is already logged in sendObserverText, maybe emit a specific event?
              console.error("[Animus SDK] Background Observer send failed:", error.message);
              // Optionally emit an event here if needed: this.eventEmitter.emit('observerSendError', error);
          });
          // Add user message to history immediately after *initiating* observer send
          // This assumes the observer path is the primary one for history if available.
          // If HTTP is primary, history update should happen in completions() or after its result.
          // Let's stick to updating history in completions() for consistency.
          // this.addMessageToHistory(userMessage); // MOVED to completions()
      } else {
          // If observer isn't connected, the HTTP path will handle history.
      }

      // 2. Call main completions method for the HTTP request (handles history update internally)
      // This is the primary return value (either response or stream)
      return this.completions(completionRequest);
  }

  /**
   * Helper function to update history consistently.
   * Cleans <think> tags from assistant messages before adding.
   * Kept private as it's called internally by finalizeAssistantResponse or non-streaming completions.
   */
  private addMessageToHistory(message: ChatMessage | null): void {
      // Skip null/undefined messages or in no-history mode
      if (!message || !this.config || !this.config.historySize || this.config.historySize <= 0) return;

      const historySize = this.config.historySize;

      // Deep clone to avoid external mutations
      const messageToAdd = { ...message };

      if (messageToAdd.role === 'assistant') {
          let finalContent = messageToAdd.content || '';
          let reasoning: string | undefined = undefined;

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

          // Update messageToAdd with cleaned content and reasoning
          messageToAdd.content = finalContent;
          if (reasoning) {
              messageToAdd.reasoning = reasoning;
          }

          // Only push if there's actual visible content OR if reasoning was extracted
          if (!finalContent && !reasoning) {
               console.log("[Animus SDK] Assistant message had no visible content or reasoning after processing, not adding to history.");
               return; // Don't add empty/whitespace-only assistant messages without reasoning
          }
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
    */
   public addAssistantResponseToHistory(assistantContent: string, compliance_violations?: string[] | null): void {
       // If compliance violations exist, log and do not add to history
       if (compliance_violations && compliance_violations.length > 0) {
           console.warn(`[Animus SDK] Assistant response not added to history due to compliance violations: ${compliance_violations.join(', ')}`);
           return;
       }

       // Don't add empty responses even if no compliance issues
       if (!assistantContent) return;

       const assistantMessage: ChatMessage = { role: 'assistant', content: assistantContent };
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
               (msg.role === 'user' || msg.role === 'assistant') &&
               typeof msg.content === 'string'
           );
           
           validMessages.forEach(msg => this.addMessageToHistory({ ...msg }));
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

       // Only allow updating user or assistant messages (not system)
       if (currentMessage.role !== 'user' && currentMessage.role !== 'assistant') {
           console.error(`[Animus SDK] Cannot update message with role: ${currentMessage.role}`);
           return false;
       }

       // Only allow updating to valid roles (user or assistant)
       if (updatedMessage.role && updatedMessage.role !== 'user' && updatedMessage.role !== 'assistant') {
           console.error(`[Animus SDK] Cannot update message to invalid role: ${updatedMessage.role}`);
           return false;
       }

       // Apply the update - safely using non-null assertion since index was validated
       const originalMessage = this.chatHistory[index]!;
       
       // Create a properly typed merge that guarantees the required properties
       // First make a copy of the original (ensures all required fields exist)
       const newMessage: ChatMessage = {
           role: originalMessage.role,
           content: originalMessage.content,
           name: originalMessage.name,
           reasoning: originalMessage.reasoning
       };
       
       // Then apply updates (ensuring role remains valid)
       if (updatedMessage.role) {
           newMessage.role = updatedMessage.role;
       }
       
       if (updatedMessage.content !== undefined) {
           newMessage.content = updatedMessage.content;
       }
       
       if (updatedMessage.name !== undefined) {
           newMessage.name = updatedMessage.name;
       }
       
       if (updatedMessage.reasoning !== undefined) {
           newMessage.reasoning = updatedMessage.reasoning;
       }

       // If updating assistant message content, process thoughts
       if (newMessage.role === 'assistant' && updatedMessage.content !== undefined) {
           let finalContent = newMessage.content || '';
           let reasoning: string | undefined = undefined;

           // Extract reasoning from <think></think> blocks if present
           const thinkRegex = /<think>([\s\S]*?)<\/think>/;
           const match = finalContent.match(thinkRegex);

           if (match && match[0] && match[1]) {
               reasoning = match[1].trim();
               // Replace the think block with nothing and ensure consistent spacing
               finalContent = finalContent.replace(match[0], '').trim();
               // Fix any double spaces that might occur when removing the block
               finalContent = finalContent.replace(/\s{2,}/g, ' ');
           } else {
               finalContent = finalContent.trim();
           }

           // Update with processed content
           newMessage.content = finalContent;
           if (reasoning) {
               newMessage.reasoning = reasoning;
           }
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
    * Clears the entire chat history.
    * This will remove all user and assistant messages, but won't affect the system message.
    *
    * @returns The number of messages that were cleared
    */
   public clearChatHistory(): number {
       const clearedCount = this.chatHistory.length;
       this.chatHistory = [];
       return clearedCount;
   }
}