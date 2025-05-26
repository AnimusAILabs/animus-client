/**
 * Utility functions for conversational turns feature
 */

/**
 * Handles sentence extraction from text with comprehensive edge case handling
 */
export class SentenceExtractor {
  /**
   * Enhanced sentence splitting that handles multiple languages and edge cases
   * @param text Text to split into sentences
   * @returns Array of sentences
   */
  public static extractSentences(text: string): string[] {
    if (!text?.trim()) return [];
    
    console.log('[SentenceExtractor] Input text:', text);
    
    // Common abbreviations (English and some international)
    const abbreviations = /\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|etc|i\.e|e\.g|Inc|Corp|Ltd|Co|Ave|St|Rd|Blvd|Vol|No|Fig|Ref|Ch|Sec|Art|Par|cf|viz|approx|est|max|min|misc|temp|dept|govt|assn|bros|mfg|mfr|natl|intl|univ|acad|admin|assoc|corp|dept|dist|div|est|exec|govt|inst|intl|mgmt|natl|org|prof|pub|res|tech|univ)\./gi;
    
    // Technical patterns that use periods but aren't sentence endings
    const technicalPatterns = [
      // URLs and domains: www.example.com, api.service.com/v1
      /(?:https?:\/\/)?(?:www\.)?[\w-]+\.[\w.-]+(?:\/[\w\-._~:/?#[\]@!$&'()*+,;=]*)?/g,
      // IP addresses: 192.168.1.1
      /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
      // Version numbers: v1.2.3, Node.js 18.0.1
      /\b(?:v\d+\.|\d+\.)\d+(?:\.\d+)*\b/g,
      // Decimal numbers: 3.14, $29.99, 12.5%
      /\b\d+\.\d+(?:[%$€£¥]|\b)/g,
      // File extensions: .js, .html, .json (when not at sentence end)
      /\.\w{2,4}(?=\s+[a-z])/g,
      // Initials: J.K. Rowling, U.S.A.
      /\b[A-Z]\.(?:[A-Z]\.)*(?=\s+[A-Z])/g,
      // Time formats: 3.30 PM, 12.30pm
      /\b\d{1,2}\.\d{2}\s*(?:AM|PM|am|pm)\b/g,
      // Mathematical expressions: f(x) = 2.5x + 1.0
      /\b\d+\.\d+[a-zA-Z]\b/g,
      // Method calls with parentheses: Math.floor(), console.log()
      /\b[A-Z][a-zA-Z]*\.[a-zA-Z]+\(\)/g,
      // Object property access: object.property (but not spanning multiple sentences)
      /\b[a-zA-Z_$][a-zA-Z0-9_$]*\.[a-zA-Z_$][a-zA-Z0-9_$]*(?=\s|$|[^\w.])/g,
    ];
    
    // Replace patterns with placeholders to protect them
    const placeholders: string[] = [];
    let processedText = text;
    
    // Handle abbreviations
    processedText = processedText.replace(abbreviations, (match) => {
      const placeholder = `__PLACEHOLDER_${placeholders.length}__`;
      placeholders.push(match);
      return placeholder;
    });
    
    // Handle technical patterns
    technicalPatterns.forEach(pattern => {
      processedText = processedText.replace(pattern, (match) => {
        const placeholder = `__PLACEHOLDER_${placeholders.length}__`;
        placeholders.push(match);
        return placeholder;
      });
    });
    
    // Handle quoted text - preserve sentence endings that come after quotes
    const quotedTextPattern = /["'«»""]([^"'«»""]*?)["'«»""]([.!?]*)/g;
    processedText = processedText.replace(quotedTextPattern, (match, content, punctuation) => {
      const placeholder = `__PLACEHOLDER_${placeholders.length}__`;
      placeholders.push(`"${content}"`); // Store just the quoted content
      return placeholder + (punctuation || ''); // Preserve any punctuation after quotes
    });
    
    // Handle parenthetical text - protect periods inside parentheses
    const parentheticalPattern = /\([^)]*\)/g;
    processedText = processedText.replace(parentheticalPattern, (match) => {
      const placeholder = `__PLACEHOLDER_${placeholders.length}__`;
      placeholders.push(match);
      return placeholder;
    });
    
    // Split on sentence endings that are followed by whitespace, end of string, or start of new sentence
    // Handles: . ! ? and combinations like ?! !! ??? etc.
    // Also handles Spanish inverted punctuation: ¿ ¡
    // Also handles em-dashes as sentence breaks: — (em-dash) and -- (double hyphen)
    // Enhanced sentence ending detection that handles both formal and informal text
    // Splits on: punctuation + space + letter OR end of string OR before quotes OR emoji + space + letter
    // Uses Unicode property escape \p{Emoji} to match any emoji character
    const sentenceEnders = /[.!?]+(?=\s+[A-Za-z¿¡]|\s*$)|[.!?]+(?=\s*["'«»""])|[¿¡][^¿¡!?]*[!?]+|—|--|\p{Emoji}(?=\s+[A-Za-z¿¡])/gu;
    console.log('[SentenceExtractor] Processed text:', processedText);
    console.log('[SentenceExtractor] Using regex:', sentenceEnders);
    
    const sentences: string[] = [];
    let lastIndex = 0;
    let match;
    
    while ((match = sentenceEnders.exec(processedText)) !== null) {
      console.log('[SentenceExtractor] Found match:', match[0], 'at index:', match.index);
      const sentence = processedText.slice(lastIndex, match.index + match[0].length).trim();
      console.log('[SentenceExtractor] Extracted sentence:', sentence);
      if (sentence.length > 0) {
        sentences.push(sentence);
      }
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text if any
    const remaining = processedText.slice(lastIndex).trim();
    console.log('[SentenceExtractor] Remaining text:', remaining);
    if (remaining.length > 0) {
      sentences.push(remaining);
    }
    
    console.log('[SentenceExtractor] Sentences before placeholder restoration:', sentences);
    
    // Restore all placeholders
    const finalSentences = sentences.map(sentence => {
      let restored = sentence;
      placeholders.forEach((original, index) => {
        restored = restored.replace(`__PLACEHOLDER_${index}__`, original);
      });
      return restored.trim();
    }).filter(sentence => sentence.length > 0); // Remove any empty sentences
    
    console.log('[SentenceExtractor] Final sentences:', finalSentences);
    return finalSentences;
  }
}

/**
 * Handles delay calculation for realistic typing simulation
 */
export class DelayCalculator {
  /**
   * Calculate realistic typing delay based on content and configuration
   * @param content Text content to calculate delay for
   * @param baseWPM Base words per minute typing speed
   * @param speedVariation Variation factor (0-1) for randomness
   * @param minDelay Minimum delay in milliseconds
   * @param maxDelay Maximum delay in milliseconds
   * @returns Calculated delay in milliseconds
   */
  public static calculateDelay(
    content: string, 
    baseWPM: number, 
    speedVariation: number, 
    minDelay: number, 
    maxDelay: number
  ): number {
    const wordCount = content.trim().split(/\s+/).length;
    
    // Apply variation (±speedVariation by default)
    const variation = 1 + (Math.random() - 0.5) * 2 * speedVariation;
    const adjustedWPM = baseWPM * variation;
    
    // Variable speed: slower for longer messages
    const lengthFactor = Math.min(1 + (wordCount / 50), 2); // Up to 2x slower for very long messages
    const effectiveWPM = adjustedWPM / lengthFactor;
    
    // Calculate delay in milliseconds
    const delayMs = (wordCount / effectiveWPM) * 60 * 1000;
    
    // Apply min/max bounds
    return Math.max(minDelay, Math.min(maxDelay, delayMs));
  }
}