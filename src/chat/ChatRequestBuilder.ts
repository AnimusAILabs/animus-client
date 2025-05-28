import type { AnimusChatOptions } from '../AnimusClient';
import type {
  ChatMessage,
  ChatCompletionRequest,
  ToolCall
} from './types';
import { ChatHistory } from './ChatHistory';

/**
 * Handles all request building functionality for chat completions.
 * Responsible for parameter merging, message preparation, payload construction, and validation.
 */
export class ChatRequestBuilder {
  private config?: AnimusChatOptions;
  private systemMessage?: ChatMessage;
  private chatHistory: ChatHistory;

  constructor(
    config?: AnimusChatOptions,
    systemMessage?: ChatMessage,
    chatHistory?: ChatHistory
  ) {
    this.config = config;
    this.systemMessage = systemMessage;
    this.chatHistory = chatHistory || new ChatHistory(config);
  }

  /**
   * Updates the configuration and system message
   */
  public updateConfig(config: AnimusChatOptions, systemMessage?: ChatMessage): void {
    this.config = config;
    this.systemMessage = systemMessage;
  }

  /**
   * Validates essential configuration for chat requests
   */
  public validateConfig(): void {
    if (!this.config?.model) {
      throw new Error('Chat model must be configured in AnimusClient chat options to use chat methods.');
    }
    if (!this.systemMessage) {
      throw new Error('Chat systemMessage must be configured in AnimusClient chat options to use chat methods.');
    }
  }

  /**
   * Builds a complete chat completion request payload
   */
  public buildCompletionRequest(request: ChatCompletionRequest): Record<string, any> {
    // Validate essential config presence
    this.validateConfig();

    const defaults = this.config!; // Use non-null assertion since validateConfig ensures it exists

    // Start with defaults from config, then override with request params
    const payload: Record<string, any> = {
      // Core required params (request overrides config)
      model: request.model ?? defaults.model,
      messages: request.messages, // Placeholder, will be updated with history logic

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
    const reasoningEnabled = 'reasoning' in request ? request.reasoning : defaults.reasoning;
    if (reasoningEnabled) {
      payload.reasoning = true;
      payload.show_reasoning = true;
    }

    // Set tool_choice to "auto" if tools are present, otherwise leave it undefined
    if (payload.tools && payload.tools.length > 0) {
      // If request specifically said "none", respect it. Otherwise, "auto".
      payload.tool_choice = request.tool_choice === "none" ? "none" : "auto";
    } else if (request.tool_choice) { // If no tools, but tool_choice is in request (e.g. "none")
      payload.tool_choice = request.tool_choice;
    }

    // Build messages array with system message and history
    payload.messages = this.buildMessagesArray(request.messages);

    // Remove undefined values
    this.removeUndefinedValues(payload);

    return payload;
  }

  /**
   * Builds the messages array including system message, history, and new messages
   */
  public buildMessagesArray(newMessages: ChatMessage[]): ChatMessage[] {
    // Start with the configured system message
    let messagesToSend: ChatMessage[] = [this.systemMessage!]; // Use non-null assertion (validated above)

    // Add history (if applicable), ensuring it doesn't exceed window size
    const historySize = this.config?.historySize ?? 0;
    // Only apply history if historySize > 0 AND chat config was provided
    if (historySize > 0 && this.chatHistory.getHistoryLength() > 0) {
      // Calculate available slots for history (window size minus new user messages)
      const availableSlots = historySize - newMessages.length;
      if (availableSlots > 0) {
        const historyCount = Math.min(this.chatHistory.getHistoryLength(), availableSlots);
        const historyMessages = this.chatHistory.getRawHistory().slice(-historyCount);
        
        // Reconstruct grouped messages for API requests
        const reconstructedHistory = this.chatHistory.reconstructGroupedMessages(historyMessages);
        
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
    messagesToSend.push(...newMessages);

    return messagesToSend;
  }

  /**
   * Builds a request for the send() method with proper parameter merging
   */
  public buildSendRequest(
    userMessage: ChatMessage,
    options?: Omit<ChatCompletionRequest, 'messages' | 'model'> & { model?: string }
  ): ChatCompletionRequest {
    // Ensure chat config exists
    if (!this.config || !this.systemMessage) {
      throw new Error('Chat options (model, systemMessage) must be configured in AnimusClient to use chat.send()');
    }

    const defaults = this.config!; // Use non-null assertion since we validated above
    const requestOptions = options || {};

    const completionRequest: ChatCompletionRequest = {
      messages: [userMessage], // Only the new user message for the API call (history handled by buildMessagesArray)
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

    // Add reasoning parameters if enabled
    const reasoningEnabled = 'reasoning' in requestOptions ? requestOptions.reasoning : defaults.reasoning;
    if (reasoningEnabled) {
      (completionRequest as Record<string, any>).reasoning = true;
      (completionRequest as Record<string, any>).show_reasoning = true;
    }

    // Remove undefined values
    this.removeUndefinedValues(completionRequest);

    return completionRequest;
  }

  /**
   * Prepares messages for send() method including system message and history
   */
  public prepareSendMessages(userMessage: ChatMessage): ChatMessage[] {
    const messagesToSend = [this.systemMessage!]; // Non-null assertion (validated above)
    
    // Add history if applicable
    const historySize = this.config?.historySize ?? 0;
    if (historySize > 0 && this.chatHistory.getHistoryLength() > 0) {
      // Calculate available slots for history
      const availableSlots = historySize - 1; // Reserve one slot for the new user message
      if (availableSlots > 0) {
        const historyCount = Math.min(this.chatHistory.getHistoryLength(), availableSlots);
        const historyMessages = this.chatHistory.getRawHistory().slice(-historyCount);
        
        // Reconstruct grouped messages for API requests
        const reconstructedHistory = this.chatHistory.reconstructGroupedMessages(historyMessages);
        messagesToSend.push(...reconstructedHistory);
      }
    }
    
    // Add the user message
    messagesToSend.push(userMessage);
    
    return messagesToSend;
  }

  /**
   * Helper method to determine if autoTurn is enabled from the configuration
   */
  private getAutoTurnEnabled(autoTurnConfig: boolean | import('../conversational-turns/types').ConversationalTurnsConfig | undefined): boolean {
    if (typeof autoTurnConfig === 'boolean') {
      return autoTurnConfig;
    } else if (typeof autoTurnConfig === 'object' && autoTurnConfig !== null) {
      return autoTurnConfig.enabled;
    }
    return false;
  }

  /**
   * Removes undefined values from the payload object
   */
  private removeUndefinedValues(payload: Record<string, any>): void {
    Object.keys(payload).forEach(key => {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    });
  }
}