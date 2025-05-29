import { ConversationalTurnsConfig } from './types';

/**
 * Default configuration values for conversational turns feature
 */
export const DEFAULT_CONVERSATIONAL_TURNS_CONFIG: Required<ConversationalTurnsConfig> = {
  enabled: false,
  splitProbability: 0.6, // 60% chance to split for natural variation
  baseTypingSpeed: 38, // WPM
  speedVariation: 0.2, // ±20%
  minDelay: 1000, // ms
  maxDelay: 4000, // ms
  maxTurns: 3, // Maximum turns allowed (including next flag)
  followUpDelay: 2000, // 2 seconds delay before follow-up requests
  maxSequentialFollowUps: 2 // Maximum sequential follow-ups allowed
};

/**
 * Validator for conversational turns configuration
 */
export class ConversationalTurnsConfigValidator {
  /**
   * Validates the provided configuration
   * @param config Configuration to validate
   * @throws Error if configuration is invalid
   */
  public static validate(config?: ConversationalTurnsConfig): void {
    if (!config || !config.enabled) return;
    
    if (config.splitProbability !== undefined &&
        (config.splitProbability < 0 || config.splitProbability > 1)) {
      throw new Error('conversationalTurns.splitProbability must be between 0 and 1');
    }
    
    if (config.baseTypingSpeed !== undefined && config.baseTypingSpeed <= 0) {
      throw new Error('conversationalTurns.baseTypingSpeed must be positive');
    }
    
    if (config.speedVariation !== undefined &&
        (config.speedVariation < 0 || config.speedVariation > 1)) {
      throw new Error('conversationalTurns.speedVariation must be between 0 and 1');
    }
    
    if (config.minDelay !== undefined && config.minDelay < 0) {
      throw new Error('conversationalTurns.minDelay must be non-negative');
    }
    
    if (config.maxDelay !== undefined && config.maxDelay < 0) {
      throw new Error('conversationalTurns.maxDelay must be non-negative');
    }
    
    if (config.minDelay !== undefined && config.maxDelay !== undefined &&
        config.minDelay > config.maxDelay) {
      throw new Error('conversationalTurns.minDelay cannot be greater than maxDelay');
    }
    
    if (config.maxTurns !== undefined && config.maxTurns < 1) {
      throw new Error('conversationalTurns.maxTurns must be at least 1');
    }
    
    
    if (config.followUpDelay !== undefined && config.followUpDelay < 0) {
      throw new Error('conversationalTurns.followUpDelay must be non-negative');
    }
    
    if (config.maxSequentialFollowUps !== undefined && config.maxSequentialFollowUps < 0) {
      throw new Error('conversationalTurns.maxSequentialFollowUps must be non-negative');
    }
  }
  
  /**
   * Merges provided config with defaults
   * @param config Partial configuration to merge
   * @returns Complete configuration with defaults applied
   */
  public static mergeWithDefaults(config?: ConversationalTurnsConfig): Required<ConversationalTurnsConfig> {
    return { ...DEFAULT_CONVERSATIONAL_TURNS_CONFIG, ...config };
  }
  
  /**
   * Creates a full configuration from a simple boolean autoTurn setting
   * @param autoTurn Boolean indicating if auto-turn should be enabled
   * @returns Complete configuration with defaults applied
   */
  public static fromAutoTurn(autoTurn?: boolean): ConversationalTurnsConfig {
    return {
      ...DEFAULT_CONVERSATIONAL_TURNS_CONFIG,
      enabled: autoTurn ?? false
    };
  }
}