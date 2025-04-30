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
  ) {
    this.requestUtil = requestUtil;
    this.config = chatOptions;

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

    // Start with defaults from config, then override with request params
    const defaults = this.config || {};
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

     // Remove undefined values to avoid sending them in the payload
     Object.keys(payload).forEach(key => {
        if (payload[key] === undefined) {
            delete payload[key];
        }
    });
    // --- End Parameter Validation & Merging ---


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


    if (payload.stream) { // Check the final payload value
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

      // Need to get access to the AnimusClient instance to use unified events
      if ('requestUtil' in this.requestUtil && 'client' in this.requestUtil) {
        const client = (this.requestUtil as any).client;
        
        // If AnimusClient is available with processHttpStream, use that
        if (client && typeof client.processHttpStream === 'function') {
          // The client will handle events and history updates via the processHttpStream method
          // If using the client's stream processor, it handles events, so we return an empty async iterable
          // to satisfy the type signature, but the consumer should rely on events.
          // This path is less likely to be hit directly in tests unless the client is fully mocked.
          client.processHttpStream(response);
          return (async function*() {})(); // Return empty async generator
        }
      }

      // --- Fallback: Return AsyncGenerator ---
      // If AnimusClient or processHttpStream is not available, return an async generator
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
                 self.addAssistantResponseToHistory(accumulatedContent, complianceViolations);
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
                  // Decide if you want to throw or just continue
                }
              }
            }
          }
        } catch (error) {
          console.error("[Animus SDK] Error processing HTTP stream:", error);
          // Optionally re-throw or handle the error appropriately
          throw error; // Re-throwing might be best to signal failure
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
  public async send(
      messageContent: string,
      options?: Omit<ChatCompletionRequest, 'messages' | 'stream' | 'model'> & { model?: string } // Allow optional model override for fallback
  ): Promise<ChatCompletionResponse | void> { // <-- Updated return type

      const userMessage: ChatMessage = { role: 'user', content: messageContent };

      // --- Observer Path ---
      if (this.isObserverConnected()) {
          // Ensure chat config exists for system message and params
          if (!this.config || !this.systemMessage) {
              throw new Error('Chat options (model, systemMessage) must be configured in AnimusClient to use chat.send() with Observer.');
          }

          const historySize = this.config.historySize ?? 0; // Get history size config

          // 1. Construct Messages Array (System + History + New User Message)
          let messagesToSend: ChatMessage[] = [this.systemMessage];
          // Get history BEFORE adding the new user message
          if (historySize > 0 && this.chatHistory.length > 0) {
              // Correctly calculate the number of history messages to fetch based on historySize
              const historyCountToFetch = Math.min(this.chatHistory.length, historySize);
              if (historyCountToFetch > 0) {
                  const relevantHistory = this.chatHistory.slice(-historyCountToFetch)
                      // Map history to exclude the 'reasoning' field before sending
                      .map(({ role, content, name }) => ({ role, content, ...(name && { name }) }));
                  // Add the fetched history after the system message
                  messagesToSend.push(...relevantHistory);
              }
          }
          // ALWAYS add the new user message at the end
          messagesToSend.push(userMessage);
          // NOTE: The history array (this.chatHistory) itself is updated AFTER the send succeeds.


          // 3. Construct LLM Params Object (from config, filtering undefined)
          const llmParams: Record<string, any> = {
              model: this.config.model, // Model is required in config
              temperature: this.config.temperature,
              max_completion_tokens: this.config.max_tokens, // Map SDK's max_tokens
              top_p: this.config.top_p,
              stop: this.config.stop,
              // Add other params supported by the agent if they exist in config
              // presence_penalty: this.config.presence_penalty,
              // frequency_penalty: this.config.frequency_penalty,
              // top_k: this.config.top_k,
              // repetition_penalty: this.config.repetition_penalty,
          };
          Object.keys(llmParams).forEach(key => {
              if (llmParams[key] === undefined) {
                  delete llmParams[key];
              }
          });

          // 3. Construct Final Payload
          const payload: Record<string, any> = {
              messages: messagesToSend,
          };
          // Only include llm_params if it's not empty
          if (Object.keys(llmParams).length > 0) {
              payload.llm_params = llmParams;
          }

          const payloadString = JSON.stringify(payload);

          try {
              // Send the complete JSON payload string
              console.log('[Animus SDK] Sending OBSERVER payload:', payloadString); // Log payload string
              await this.sendObserverText(payloadString);

              // 4. History Update (Observer Path) - Add user message AFTER successful send
              this.addMessageToHistory(userMessage); // Add user message to internal history

              // Return void for the observer path
              return;
          } catch (error) {
               console.error("Error sending message via Observer:", error);
               // No need to remove user message from history here, as it's added *after* successful send
               throw error; // Re-throw the error
           }
      }

      // --- Fallback to HTTP API Path ---
      console.warn("Observer not connected. Sending message via standard API.");

      // Ensure chat config exists (already checked for observer path, re-check for clarity)
      if (!this.config || !this.systemMessage) {
          throw new Error('Chat options (model, systemMessage) must be configured in AnimusClient to use chat.send() fallback.');
      }

      // Prepare the request for the completions method, merging options and config
      const defaults = this.config; // Use validated config
      const requestOptions = options || {};

      const completionRequest: ChatCompletionRequest = {
          messages: [userMessage], // Only the new user message

          // Merge parameters: options override config defaults
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
          // Compliance defaults to true if not specified in options or config
          compliance: requestOptions.compliance ?? defaults.compliance ?? true,

          stream: false, // send() explicitly does not support streaming via HTTP fallback
      };

       // Remove undefined values before sending
       Object.keys(completionRequest).forEach(key => {
           if ((completionRequest as any)[key] === undefined) {
               delete (completionRequest as any)[key];
           }
       });

      // Call the main completions method for the HTTP request
      // Type assertion needed because fallback guarantees non-streaming
      return await this.completions(completionRequest) as ChatCompletionResponse;
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