import type { 
  ChatCompletionChunk, 
  ToolCall, 
  ChatMessage 
} from './types';
import type { GroupMetadata } from '../conversational-turns/types';
import type { ConversationalTurnsManager } from '../conversational-turns';
import type { ChatHistory } from './ChatHistory';

/**
 * Handles all streaming-related functionality for chat completions.
 * This class encapsulates the complex logic for processing streaming responses,
 * accumulating chunks, handling tool calls, and managing events.
 */
export class StreamingHandler {
  private eventEmitter?: (event: string, data: any) => void;
  private conversationalTurnsManager?: ConversationalTurnsManager;
  private chatHistory: ChatHistory;
  private addAssistantResponseToHistory: (
    content: string | null,
    violations?: string[] | null,
    toolCalls?: ToolCall[],
    groupMetadata?: GroupMetadata,
    reasoning?: string | null
  ) => void;
  private sendFollowUpRequest: () => void;

  constructor(
    eventEmitter: ((event: string, data: any) => void) | undefined,
    conversationalTurnsManager: ConversationalTurnsManager | undefined,
    chatHistory: ChatHistory,
    addAssistantResponseToHistory: (
      content: string | null,
      violations?: string[] | null,
      toolCalls?: ToolCall[],
      groupMetadata?: GroupMetadata,
      reasoning?: string | null
    ) => void,
    sendFollowUpRequest: () => void
  ) {
    this.eventEmitter = eventEmitter;
    this.conversationalTurnsManager = conversationalTurnsManager;
    this.chatHistory = chatHistory;
    this.addAssistantResponseToHistory = addAssistantResponseToHistory;
    this.sendFollowUpRequest = sendFollowUpRequest;
  }

  /**
   * Processes a streaming response and yields chunks while accumulating the complete response.
   * This is the main streaming generator function that handles all streaming logic.
   * 
   * @param response - The streaming Response object from the API
   * @returns AsyncIterable<ChatCompletionChunk> - Generator that yields parsed chunks
   */
  async* processStream(response: Response): AsyncIterable<ChatCompletionChunk> {
    let accumulatedContent: string | null = ''; // Can be null if only tool_calls
    let accumulatedToolCalls: ToolCall[] = [];
    let complianceViolations: string[] | undefined;
    let accumulatedTurns: string[] | undefined;
    let hasNext: boolean | undefined;
    let accumulatedReasoning: string | null = null;
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
              if (this.conversationalTurnsManager) {
                
                const wasProcessed = this.conversationalTurnsManager.processResponse(
                  accumulatedContent,
                  complianceViolations,
                  accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
                  accumulatedTurns,
                  undefined, // imagePrompt - not supported in streaming yet
                  hasNext,
                  accumulatedReasoning
                );
                
                // If not processed by turns manager, emit completion event and add to history directly
                if (!wasProcessed) {
                  // Emit messageComplete event
                  if (this.eventEmitter) {
                    this.eventEmitter('messageComplete', {
                      content: accumulatedContent || '',
                      ...(accumulatedReasoning && { reasoning: accumulatedReasoning }),
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
              } else {
                // No turns manager, emit completion event and add to history
                if (this.eventEmitter) {
                  this.eventEmitter('messageComplete', {
                    content: accumulatedContent || '',
                    ...(accumulatedReasoning && { reasoning: accumulatedReasoning }),
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
                
                this.sendFollowUpRequest();
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
                        if (this.eventEmitter) {
                          this.eventEmitter('messageTokens', { content: delta.content });
                        }
                        
                        // Periodically emit progress events 
                        if (this.eventEmitter && (accumulatedContent.length % 20 === 0)) {
                          this.eventEmitter('messageProgress', { 
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
                    
                    // Accumulate reasoning content
                    if (delta.reasoning) {
                        if (accumulatedReasoning === null) accumulatedReasoning = "";
                        accumulatedReasoning += delta.reasoning;
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
                if (this.eventEmitter && complianceViolations.length > 0) {
                  this.eventEmitter('messageError', { 
                    error: `Compliance violations: ${complianceViolations.join(', ')}` 
                  });
                }
              }
            } catch (e) {
              
              // Re-throw error to be caught by the caller iterating the stream
              throw new Error(`Failed to parse stream chunk: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
      }
    } catch (error) {
      
      
      // Try to process with conversational turns first, even in error cases
      if (this.conversationalTurnsManager && accumulatedContent) {
        const wasProcessed = this.conversationalTurnsManager.processResponse(
          accumulatedContent,
          complianceViolations,
          accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
          undefined, // apiTurns - not available in error case
          undefined, // imagePrompt - not supported in streaming yet
          undefined  // hasNext - not available in error case
        );
        
        // If not processed by turns manager, fall back to standard history update
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
        // No turns manager or no content, just add to history directly
        this.addAssistantResponseToHistory(
          accumulatedContent,
          complianceViolations,
          accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
          undefined,
          null
        );
      }
      
      // Emit error event
      if (this.eventEmitter) {
        this.eventEmitter('messageError', { 
          error: error instanceof Error ? error : String(error) 
        });
      }
      
      throw error; // Re-throwing allows caller to handle
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Processes streaming response for the send() method.
   * This handles the streaming logic within the send() method's async IIFE.
   * 
   * @param response - The streaming Response object from the API
   */
  async processSendStream(response: Response): Promise<void> {
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
    let accumulatedReasoning: string | null = null;
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
                const wasProcessed = this.conversationalTurnsManager.processResponse(
                  accumulatedContent,
                  complianceViolations,
                  accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
                  accumulatedTurns,
                  undefined, // imagePrompt - not supported in streaming yet
                  hasNext,
                  accumulatedReasoning
                );
                
                // Always emit messageComplete regardless of whether it was processed by turns
                if (this.eventEmitter) {
                  this.eventEmitter('messageComplete', {
                    content: accumulatedContent || '',
                    ...(accumulatedReasoning && { reasoning: accumulatedReasoning }),
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
                    ...(accumulatedReasoning && { reasoning: accumulatedReasoning }),
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
                  
                  // Accumulate reasoning content
                  if (delta.reasoning) {
                    if (accumulatedReasoning === null) accumulatedReasoning = "";
                    accumulatedReasoning += delta.reasoning;
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
      
      // Emit error event
      if (this.eventEmitter) {
        this.eventEmitter('messageError', { 
          error: error instanceof Error ? error : String(error)
        });
      }
    } finally {
      reader.releaseLock();
    }
  }
}