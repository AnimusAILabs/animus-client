import type { ChatMessage, ToolCall } from './types';
import type { GroupMetadata } from '../conversational-turns/types';
import type { AnimusChatOptions } from '../AnimusClient';

/**
 * Manages chat history functionality including adding, updating, deleting, and retrieving messages.
 * Handles message processing, grouping, and history size limits.
 */
export class ChatHistory {
  private chatHistory: ChatMessage[] = [];
  private config?: AnimusChatOptions;

  constructor(config?: AnimusChatOptions) {
    this.config = config;
  }

  /**
   * Updates the configuration for this chat history manager.
   * @param config Updated chat configuration options
   */
  public updateConfig(config: AnimusChatOptions): void {
    this.config = config;
  }

  /**
   * Helper function to update history consistently.
   * Cleans <think> tags from assistant messages before adding.
   * Kept private as it's called internally by addAssistantResponseToHistory or other methods.
   */
  private addMessageToHistory(message: ChatMessage | null): void {
    // Skip null/undefined messages or in no-history mode
    if (!message || !this.config || !this.config.historySize || this.config.historySize <= 0) return;
    
    // Skip continuation messages from being added to history
    if (message.role === 'user' && message.content === '[CONTINUE]') {
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
        let reasoning: string | undefined = messageToAdd.reasoning; // Preserve existing reasoning from API
        const toolCalls = messageToAdd.tool_calls; // Preserve tool_calls

        // Reasoning extraction only applies if there's content
        if (finalContent) {
            // Extract reasoning from <think></think> blocks if present
            const thinkRegex = /<think>([\s\S]*?)<\/think>/; // Matches first <think>...</think> block
            const match = finalContent.match(thinkRegex); // Match on the original content

            if (match && match[0] && match[1]) {
                // Found a think block - only override existing reasoning if we don't already have it
                if (!reasoning) {
                    reasoning = match[1].trim(); // Extract content inside tags
                }
                // Construct the cleaned content by removing the matched block
                finalContent = finalContent.replace(match[0], '').trim();
                // Fix any double spaces that might occur when removing the block
                finalContent = finalContent.replace(/\s{2,}/g, ' ');
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
             return; // Don't add empty/whitespace-only assistant messages without reasoning or tool_calls
        }
    } else if (messageToAdd.role === 'tool') {
      // For tool messages, content is required (the result of the tool call)
      // and tool_call_id is required.
      if (!messageToAdd.content || !messageToAdd.tool_call_id) {
          return;
      }
      // No further processing needed for tool messages, just ensure they are added.
    }

    // Add the processed message (user or cleaned assistant) to history
    // Insert in chronological order based on timestamp
    const messageTimestamp = new Date(messageToAdd.timestamp!).getTime();
    
    // Find the correct insertion point to maintain chronological order
    let insertIndex = this.chatHistory.length;
    for (let i = this.chatHistory.length - 1; i >= 0; i--) {
        const existingTimestamp = new Date(this.chatHistory[i]!.timestamp!).getTime();
        if (existingTimestamp <= messageTimestamp) {
            break;
        }
        insertIndex = i;
    }
    
    // Insert at the correct position
    this.chatHistory.splice(insertIndex, 0, messageToAdd);

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
   * @param groupMetadata Optional group metadata for conversational turns.
   * @param reasoning Optional reasoning content from the assistant.
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
          console.warn(`Assistant response has compliance violations but adding to history for context: ${compliance_violations.join(', ')}`);
      }

      // Don't add empty responses if there's no content AND no tool_calls
      if (assistantContent === null && (!tool_calls || tool_calls.length === 0)) {
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
              totalInGroup: groupMetadata.totalInGroup,
              groupTimestamp: groupMetadata.groupTimestamp
          })
      };
      this.addMessageToHistory(assistantMessage);
  }

  /**
   * Adds a user message to the chat history.
   * @param message The user message to add to history.
   */
  public addUserMessageToHistory(message: ChatMessage): void {
      this.addMessageToHistory(message);
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
          console.warn('Cannot set chat history when history is disabled (historySize <= 0)');
          return 0;
      }

      if (!Array.isArray(history)) {
          console.error('Invalid history format: expected an array');
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
          console.warn('Cannot update history message when history is disabled (historySize <= 0)');
          return false;
      }

      // Check if index is valid
      if (index < 0 || index >= this.chatHistory.length) {
          console.error(`Invalid index: ${index}. History length is ${this.chatHistory.length}`);
          return false;
      }

      // Since we already validated the index, we can safely get the message
      // We use a non-null assertion (!) here since we already checked index validity
      const currentMessage = this.chatHistory[index]!;

      // Allow updating user, assistant, or tool messages (not system)
      if (currentMessage.role !== 'user' && currentMessage.role !== 'assistant' && currentMessage.role !== 'tool') {
          console.error(`Cannot update message with role: ${currentMessage.role}`);
          return false;
      }

      // Only allow updating to valid roles (user, assistant, or tool)
      const validUpdateRoles: ChatMessage['role'][] = ['user', 'assistant', 'tool'];
      if (updatedMessage.role && !validUpdateRoles.includes(updatedMessage.role)) {
          console.error(`Cannot update message to invalid role: ${updatedMessage.role}`);
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
              console.error('Invalid tool message update: content must be non-empty string and tool_call_id is required.', newMessage);
              return false;
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
          console.warn('Cannot delete history message when history is disabled (historySize <= 0)');
          return false;
      }

      // Check if index is valid
      if (index < 0 || index >= this.chatHistory.length) {
          console.error(`Invalid index: ${index}. History length is ${this.chatHistory.length}`);
          return false;
      }

      // Remove the message
      this.chatHistory.splice(index, 1);
      return true;
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
  public reconstructGroupedMessages(messages: ChatMessage[]): ChatMessage[] {
      const result: ChatMessage[] = [];
      const groupMap = new Map<string, ChatMessage[]>();
      const processedGroups = new Set<string>();
      
      // Process messages in order, maintaining position
      for (const message of messages) {
          if (message.groupId && message.messageIndex !== undefined && message.totalInGroup !== undefined) {
              // Collect grouped messages
              if (!groupMap.has(message.groupId)) {
                  groupMap.set(message.groupId, []);
              }
              groupMap.get(message.groupId)!.push(message);
              
              // If this is the first message of the group (messageIndex 0), reconstruct the group here
              if (message.messageIndex === 0 && !processedGroups.has(message.groupId)) {
                  processedGroups.add(message.groupId);
                  
                  // We need to wait until we have all messages in the group
                  // For now, add a placeholder and we'll replace it later
                  result.push({ ...message, __isPlaceholder: true } as any);
              }
              // Skip other messages in the group (they'll be part of the reconstruction)
          } else {
              // Non-grouped message, add directly
              result.push(message);
          }
      }
      
      // Replace placeholders with reconstructed messages
      for (let i = 0; i < result.length; i++) {
          const msg = result[i] as any;
          if (msg.__isPlaceholder && msg.groupId) {
              const groupMessages = groupMap.get(msg.groupId);
              if (groupMessages && groupMessages.length === msg.totalInGroup) {
                  // Sort by messageIndex to ensure correct order
                  groupMessages.sort((a, b) => (a.messageIndex || 0) - (b.messageIndex || 0));
                  
                  const firstMessage = groupMessages[0]!;
                  const lastMessage = groupMessages[groupMessages.length - 1]!;
                  
                  // Use group timestamp if available, otherwise fall back to first message timestamp
                  const groupTimestamp = firstMessage.groupTimestamp
                      ? new Date(firstMessage.groupTimestamp).toISOString()
                      : firstMessage.timestamp;

                  const reconstructedContent = groupMessages.map(msg => msg.content).join(' ');
                  
                  const reconstructedMessage: ChatMessage = {
                      role: firstMessage.role,
                      content: reconstructedContent,
                      timestamp: groupTimestamp,
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
                  
                  result[i] = reconstructedMessage;
              }
          }
      }
      
      return result;
  }

  /**
   * Gets the current chat history length
   * @returns The number of messages in the chat history
   */
  public getHistoryLength(): number {
      return this.chatHistory.length;
  }

  /**
   * Gets the raw chat history array (for internal use)
   * @returns The internal chat history array
   */
  public getRawHistory(): ChatMessage[] {
      return this.chatHistory;
  }
}