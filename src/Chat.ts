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

    // Start with essential parameters
    const payload: Record<string, any> = { // Use Record<string, any> for dynamic building
      messages: request.messages, // Placeholder, will be replaced by history logic
      model: request.model ?? this.config?.model, // Prioritize request model, then config model
    };

    // Validate model presence (either in request or config)
    if (!payload.model) {
      throw new Error('Chat model must be specified either in the request or in the AnimusClient chat configuration.');
    }
    // Validate system message presence (must be in config if chat module is used)
    if (!this.systemMessage) {
        throw new Error('Chat systemMessage must be configured in AnimusClient chat options to use chat methods.');
    }

    // Conditionally add optional parameters ONLY if they exist in the request object
    if (request.temperature !== undefined) payload.temperature = request.temperature;
    if (request.top_p !== undefined) payload.top_p = request.top_p;
    if (request.n !== undefined) payload.n = request.n;
    if (request.max_tokens !== undefined) payload.max_tokens = request.max_tokens;
    if (request.stop !== undefined) payload.stop = request.stop;
    if (request.stream !== undefined) payload.stream = request.stream;
    if (request.presence_penalty !== undefined) payload.presence_penalty = request.presence_penalty;
    if (request.frequency_penalty !== undefined) payload.frequency_penalty = request.frequency_penalty;
    if (request.best_of !== undefined) payload.best_of = request.best_of;
    if (request.top_k !== undefined) payload.top_k = request.top_k;
    if (request.repetition_penalty !== undefined) payload.repetition_penalty = request.repetition_penalty;
    if (request.min_p !== undefined) payload.min_p = request.min_p;
    if (request.length_penalty !== undefined) payload.length_penalty = request.length_penalty;
    if (request.compliance !== undefined) payload.compliance = request.compliance;


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
      // TODO: Implement history update for streaming responses.
      // This likely requires accumulating the streamed response content
      // *after* the stream completes and then updating chatHistory.
      const response = await this.requestUtil.request(
        'POST',
        '/chat/completions',
        payload,
        true // Indicate streaming
      ) as Response; // Expecting raw Response for streaming

      if (!response.body) {
        throw new ApiError('Streaming response body is null', response.status);
      }
      return this.processStream(response.body);

    } else {
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

      // Prepare the request for the completions method
      const request: ChatCompletionRequest = {
          messages: [userMessage], // Only the new user message
          // Prioritize model in options, then config, then error (handled by completions)
          model: options?.model ?? this.config.model,
          // Apply configured defaults if not overridden in options
          temperature: options?.temperature ?? this.config.temperature,
          top_p: options?.top_p ?? this.config.top_p,
          max_tokens: options?.max_tokens ?? this.config.max_tokens,
          // Spread any other options provided, potentially overriding defaults again if explicitly set
          ...options,
          stream: false, // send() does not support streaming
      };

      // Call the main completions method
      // Type assertion needed because send() guarantees non-streaming
      return await this.completions(request) as ChatCompletionResponse;
  }

  /**
   * Processes the Server-Sent Events (SSE) stream.
   */
  private async *processStream(stream: ReadableStream<Uint8Array>): AsyncIterable<ChatCompletionChunk> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
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
              return; // Stream finished signal
            }
            try {
              const chunk = JSON.parse(data) as ChatCompletionChunk;
              yield chunk;
            } catch (e) {
              console.error('Failed to parse stream chunk:', data, e);
              // Decide how to handle parse errors: continue, throw, etc.
            }
          } else {
            // Handle potential non-data lines if necessary
            console.warn('Received non-data line in stream:', line);
          }
        }
      }

      // Process any remaining buffer content if needed
      if (buffer.trim() !== '') {
         if (buffer.startsWith('data: ')) {
             const data = buffer.substring(6).trim();
             if (data !== '[DONE]') {
                 try {
                     const chunk = JSON.parse(data) as ChatCompletionChunk;
                     yield chunk;
                 } catch (e) {
                     console.error('Failed to parse final stream chunk:', data, e);
                 }
             }
         } else if (buffer.trim() !== '[DONE]') { // Avoid warning for just [DONE]
            console.warn('Stream ended with unprocessed buffer:', buffer);
         }
      }

    } finally {
      reader.releaseLock();
    }
  }
}