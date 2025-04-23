import { RequestUtil, ApiError } from './RequestUtil';
import type { AnimusChatOptions } from './AnimusClient'; // Import the new type

// --- Interfaces based on API Documentation ---

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string; // Optional name for user/assistant roles
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
}


/**
 * Module for interacting with the Chat Completions API.
 */
export class ChatModule {
  private requestUtil: RequestUtil;
 private config?: AnimusChatOptions; // Store the provided chat config
 private systemMessage?: ChatMessage; // Derived from config
 private chatHistory: ChatMessage[] = []; // Store conversation history (excluding system message)

  constructor(
     requestUtil: RequestUtil,
     chatOptions: AnimusChatOptions | undefined // Receive the whole config object or undefined
 ) {
   this.requestUtil = requestUtil;
   this.config = chatOptions;

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
   * @returns A Promise resolving to the ChatCompletionResponse if stream is false,
   *          or an AsyncIterable yielding ChatCompletionChunk objects if stream is true.
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
           const relevantHistory = this.chatHistory.slice(-historyCount);
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

      const response = await this.requestUtil.request(
        'POST',
        '/chat/completions',
        payload,
        true // Indicate streaming
      ) as Response; // Expecting raw Response for streaming

      if (!response.body) {
        throw new ApiError('Streaming response body is null', response.status);
      }
      // Pass the user messages to processStream so history can be updated
      return this.processStream(response.body, sentUserMessages);

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
         this.chatHistory.push(...request.messages);
         // Add the assistant's response
          const firstChoice = response.choices?.[0];
          if (firstChoice?.message) {
              this.chatHistory.push(firstChoice.message);
          }
          // Trim history (maintaining only user/assistant messages up to window size)
         if (this.chatHistory.length > historySize) {
             this.chatHistory = this.chatHistory.slice(-historySize);
         }
     }
      // --- End History Update ---
      return response;
    }
  }

  /**
   * Sends a single user message and gets a response, automatically handling
   * history and the configured system message.
   *
   * @param messageContent - The content of the user's message.
   * @param options - Optional: Overrides for other completion parameters (model, temperature, etc.).
   *                  Cannot override `messages` here.
   * @returns A Promise resolving to the ChatCompletionResponse. Streaming is not supported via send().
   */
  public async send(
      messageContent: string,
      options?: Omit<ChatCompletionRequest, 'messages' | 'stream' | 'model'> & { model?: string } // Allow optional model override
  ): Promise<ChatCompletionResponse> {
      // Ensure chat config (and thus system message) exists before allowing send
      if (!this.config || !this.systemMessage) {
          throw new Error('Chat options (model, systemMessage) must be configured in AnimusClient to use chat.send().');
      }

      const userMessage: ChatMessage = { role: 'user', content: messageContent };

      // Prepare the request for the completions method, merging options and config
      const defaults = this.config || {}; // Use validated config
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

          stream: false, // send() explicitly does not support streaming
      };

       // Remove undefined values before sending
       Object.keys(completionRequest).forEach(key => {
           if ((completionRequest as any)[key] === undefined) {
               delete (completionRequest as any)[key];
           }
       });

      // Call the main completions method
      // Type assertion needed because send() guarantees non-streaming
      return await this.completions(completionRequest) as ChatCompletionResponse;
  }

  /**
   * Processes the Server-Sent Events (SSE) stream and updates history upon completion.
   * @param stream The ReadableStream from the fetch response.
   * @param sentUserMessages The user messages that were part of the request triggering this stream.
   */
  private async *processStream(
      stream: ReadableStream<Uint8Array>,
      sentUserMessages: ChatMessage[] // Receive user messages for history update
  ): AsyncIterable<ChatCompletionChunk> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedContent = ''; // To store the full response content
    let finalAssistantMessage: ChatMessage | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // --- Stream ended (by closing) ---
          // This might happen if [DONE] is missed or connection drops
          break; // Exit loop to perform final history update
        }

        buffer += decoder.decode(value, { stream: true });

        // Process buffer line by line
        let lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last potentially incomplete line

        for (const line of lines) {
          if (line.trim() === '') continue; // Skip empty lines

          if (line.startsWith('data: ')) {
            const data = line.substring(6).trim();
            if (data === '[DONE]') {
              // --- Stream finished (via [DONE] signal) ---
              // Final history update happens in the finally block
              return; // End the generator cleanly
            }
            try {
              const chunk = JSON.parse(data) as ChatCompletionChunk;
              // Accumulate content from delta
              const deltaContent = chunk.choices?.[0]?.delta?.content;
              if (deltaContent) {
                  accumulatedContent += deltaContent;
              }
              yield chunk; // Yield the chunk to the consumer
            } catch (e) {
              console.error('Failed to parse stream chunk:', data, e);
            }
          } else {
            console.warn('Received non-data line in stream:', line);
          }
        }
      }

      // Process any remaining buffer content if stream ended without [DONE]
      if (buffer.trim() !== '') {
         if (buffer.startsWith('data: ')) {
             const data = buffer.substring(6).trim();
             if (data !== '[DONE]') {
                 try {
                     const chunk = JSON.parse(data) as ChatCompletionChunk;
                     const deltaContent = chunk.choices?.[0]?.delta?.content;
                     if (deltaContent) { accumulatedContent += deltaContent; }
                     yield chunk; // Yield potential last chunk
                 } catch (e) { console.error('Failed to parse final stream chunk:', data, e); }
             }
         } else { console.warn('Stream ended with unprocessed buffer:', buffer); }
      }

    } finally {
      // --- Final History Update (Guaranteed to run) ---
      if (accumulatedContent) {
          finalAssistantMessage = { role: 'assistant', content: accumulatedContent };
      }
      // Update history using the user messages passed in and the accumulated assistant message
      this.updateHistory(sentUserMessages, finalAssistantMessage);

      reader.releaseLock();
    }
  }

  /** Helper function to update history consistently */
  private updateHistory(userMessages: ChatMessage[], assistantMessage: ChatMessage | null): void {
      const historySize = this.config?.historySize ?? 0;
      // Only update if history is enabled
      if (historySize > 0) {
          // Add the user message(s) from the original request
          this.chatHistory.push(...userMessages);
          // Add the assistant's response if available
          if (assistantMessage) {
              this.chatHistory.push(assistantMessage);
          }
          // Trim history (maintaining only user/assistant messages up to window size)
          if (this.chatHistory.length > historySize) {
              this.chatHistory = this.chatHistory.slice(-historySize);
          }
      }
  }
}