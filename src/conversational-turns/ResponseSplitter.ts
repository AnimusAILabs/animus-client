import { ConversationalTurnsConfig, SplitMessage } from './types';
import { DEFAULT_CONVERSATIONAL_TURNS_CONFIG } from './config';
import { SentenceExtractor, DelayCalculator } from './utils';

/**
 * Handles the logic for splitting AI responses into multiple conversational turns
 */
export class ResponseSplitter {
  private config: Required<ConversationalTurnsConfig>;
  
  constructor(config: ConversationalTurnsConfig) {
    this.config = { ...DEFAULT_CONVERSATIONAL_TURNS_CONFIG, ...config };
  }
  
  /**
   * Determines if a response should be split and returns split messages with delays
   * @param content The full response content to potentially split
   * @returns Array of split messages with delays and turn information
   */
  public splitResponse(content: string): SplitMessage[] {
    if (!this.config.enabled || !content?.trim()) {
      return [{ content, delay: 0, turnIndex: 0, totalTurns: 1 }];
    }
    
    const sentences = SentenceExtractor.extractSentences(content);
    
    
    // Don't split single sentences
    if (sentences.length <= 1) {
      return [{ content, delay: 0, turnIndex: 0, totalTurns: 1 }];
    }
    
    // Apply probability check - only split if random value is within probability
    const shouldSplit = Math.random() <= this.config.splitProbability;
    if (!shouldSplit) {
      return [{ content, delay: 0, turnIndex: 0, totalTurns: 1 }];
    }
    
    return this.createSplitMessages(sentences);
  }
  
  /**
   * Creates split messages from an array of sentences with intelligent grouping
   * @param sentences Array of sentences to group into messages
   * @returns Array of split messages with calculated delays
   */
  private createSplitMessages(sentences: string[]): SplitMessage[] {
    const messages: SplitMessage[] = [];
    
    // First sentence always goes alone to establish the conversation
    const firstSentence = sentences[0];
    if (!firstSentence) {
      // If no sentences found, return original content as single message
      const originalContent = sentences.join(' ');
      return [{ content: originalContent, delay: 0, turnIndex: 0, totalTurns: 1 }];
    }
    
    messages.push({
      content: firstSentence,
      delay: 0, // First message has no delay
      turnIndex: 0,
      totalTurns: 0 // Will be set after all messages are created
    });
    
    // Group remaining sentences intelligently
    let currentGroup = '';
    for (let i = 1; i < sentences.length; i++) {
      const sentence = sentences[i];
      
      // Skip undefined sentences (shouldn't happen but be safe)
      if (!sentence) continue;
      
      if (currentGroup === '') {
        // Start a new group
        currentGroup = sentence;
      } else if (sentence.length <= this.config.shortSentenceThreshold) {
        // Group short sentences together for natural flow
        currentGroup += ' ' + sentence;
      } else {
        // Current sentence is long, finish current group and start new one
        messages.push({
          content: currentGroup,
          delay: this.calculateDelay(currentGroup),
          turnIndex: messages.length,
          totalTurns: 0 // Will be set after all messages are created
        });
        currentGroup = sentence;
      }
    }
    
    // Add final group if any content remains
    if (currentGroup) {
      messages.push({
        content: currentGroup,
        delay: this.calculateDelay(currentGroup),
        turnIndex: messages.length,
        totalTurns: 0 // Will be set after all messages are created
      });
    }
    
    // Set totalTurns for all messages now that we know the final count
    const totalTurns = messages.length;
    messages.forEach(msg => msg.totalTurns = totalTurns);
    
    return messages;
  }
  
  /**
   * Calculates the delay for a message based on its content and configuration
   * @param content The message content to calculate delay for
   * @returns Delay in milliseconds
   */
  private calculateDelay(content: string): number {
    return DelayCalculator.calculateDelay(
      content,
      this.config.baseTypingSpeed,
      this.config.speedVariation,
      this.config.minDelay,
      this.config.maxDelay
    );
  }
  
  /**
   * Update the splitter configuration
   * @param config New configuration to apply
   */
  public updateConfig(config: ConversationalTurnsConfig): void {
    this.config = { ...DEFAULT_CONVERSATIONAL_TURNS_CONFIG, ...config };
  }
  
  /**
   * Get current configuration
   * @returns Current configuration object
   */
  public getConfig(): Required<ConversationalTurnsConfig> {
    return { ...this.config };
  }
  
  /**
   * Check if the splitter is enabled
   * @returns True if splitting is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled;
  }
}