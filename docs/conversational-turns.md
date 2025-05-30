# Conversational Turns Feature

The Conversational Turns feature adds natural, human-like conversation flow by automatically splitting AI responses into multiple messages with realistic typing delays, coordinated image generation, and smart follow-up requests.

## Overview

When enabled, the feature:
- **Probabilistically splits** multi-sentence responses (100% chance by default, configurable)
- **Groups short sentences** together for natural flow
- **Adds realistic typing delays** based on content length and WPM calculation
- **Coordinates image generation** with conversational turns completion
- **Handles follow-up requests** automatically when the AI indicates more content is expected
- **Cancels pending messages** when the user sends a new message
- **Emits comprehensive events** for turns, image generation, and completion
- **Maintains perfect message ordering** with proper timestamps

## Configuration

### Simple Configuration

Enable the feature by setting `autoTurn: true` in your chat configuration:

```javascript
const client = new AnimusClient({
  tokenProviderUrl: 'http://localhost:3001/token',
  chat: {
    model: 'your-model-id',
    systemMessage: 'You are a helpful assistant.',
    autoTurn: true // Enable conversational turns with defaults
  }
});
```

### Advanced Configuration

For granular control, use the advanced configuration object:

```javascript
const client = new AnimusClient({
  tokenProviderUrl: 'http://localhost:3001/token',
  chat: {
    model: 'your-model-id',
    systemMessage: 'You are a helpful assistant.',
    autoTurn: {
      enabled: true,                    // Enable conversational turns
      splitProbability: 0.8,           // 80% chance to split multi-sentence responses
      shortSentenceThreshold: 25,      // Group sentences shorter than 25 characters
      baseTypingSpeed: 50,             // Base typing speed in WPM
      speedVariation: 0.3,             // ±30% speed variation for natural feel
      minDelay: 800,                   // Minimum delay between turns (ms)
      maxDelay: 2500                   // Maximum delay between turns (ms)
    }
  }
});
```

## Default Settings

When `autoTurn: true` is set, the feature uses these default settings:
- **Split Probability**: 100% chance to split multi-sentence responses
- **Short Sentence Threshold**: 30 characters (sentences shorter than this get grouped)
- **Base Typing Speed**: 45 WPM
- **Speed Variation**: ±20% randomness
- **Min Delay**: 500ms between messages
- **Max Delay**: 3000ms between messages

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable conversational turns |
| `splitProbability` | `number` | `1.0` | Probability (0-1) of splitting multi-sentence responses |
| `shortSentenceThreshold` | `number` | `30` | Character threshold for grouping short sentences |
| `baseTypingSpeed` | `number` | `45` | Base typing speed in words per minute |
| `speedVariation` | `number` | `0.2` | Speed variation factor (±percentage) |
| `minDelay` | `number` | `500` | Minimum delay between turns in milliseconds |
| `maxDelay` | `number` | `3000` | Maximum delay between turns in milliseconds |

## Events

The SDK uses a unified event system where all messages (regular, auto-turn, and follow-up) emit the same events:

### Unified Message Events

```javascript
// All message types use the same events
client.on('messageStart', (data) => {
  console.log(`Starting ${data.messageType} message: ${data.content}`);
  
  // Auto-turn specific handling
  if (data.messageType === 'auto') {
    console.log(`Turn ${data.turnIndex + 1}/${data.totalTurns}`);
  }
  
  // Follow-up specific handling
  if (data.messageType === 'followup') {
    console.log('Processing follow-up request');
  }
});

client.on('messageComplete', (data) => {
  console.log(`Completed ${data.messageType || 'regular'} message: ${data.content}`);
  
  // Auto-turn specific handling
  if (data.messageType === 'auto' && data.turnIndex !== undefined) {
    console.log(`Turn ${data.turnIndex + 1}/${data.totalTurns} complete`);
  }
  
  // All messages completed (when totalMessages is present)
  if (data.totalMessages) {
    console.log(`All ${data.totalMessages} messages completed`);
    // This is when image generation and follow-up requests are triggered
  }
});

client.on('messageError', (data) => {
  console.error(`${data.messageType || 'regular'} message error: ${data.error}`);
  
  // Handle cancellations (auto-turn messages that were canceled)
  if (data.messageType === 'auto' && data.error.includes('Canceled')) {
    console.log('Auto-turn messages were canceled due to new user input');
  }
});
```

### Message Types

- **`regular`**: Standard user-initiated messages and responses
- **`auto`**: Messages from conversational turns (split responses)
- **`followup`**: Automatic follow-up requests when AI indicates more content

### Image Generation Events

When responses include image prompts, these events are emitted:

```javascript
client.on('imageGenerationStart', (data) => {
  console.log(`Starting image generation: ${data.prompt}`);
  // Show loading indicator in UI
});

client.on('imageGenerationComplete', (data) => {
  console.log(`Image generated: ${data.imageUrl}`);
  // Display the generated image
});

client.on('imageGenerationError', (data) => {
  console.error(`Image generation failed: ${data.error}`);
  // Show error message to user
});
```

### Message Processing Events

Standard message events work alongside conversational turns:

```javascript
client.on('messageStart', (data) => {
  console.log(`Message processing started: ${data.conversationId}`);
});

client.on('messageComplete', (data) => {
  console.log(`Message complete: ${data.content}`);
  // Note: This fires for each individual turn AND the overall response
});

client.on('messageError', (data) => {
  console.error(`Message error: ${data.error}`);
});
```

## Advanced Features

### Image Generation Coordination

When AI responses include image prompts, the SDK automatically:
1. **Processes conversational turns** first (if any)
2. **Generates the image** after turns complete
3. **Adds image context to chat history** for the AI
4. **Handles follow-up requests** after image generation

```javascript
// Enable image generation
const client = new AnimusClient({
  tokenProviderUrl: 'your-token-url',
  chat: {
    model: 'your-model',
    systemMessage: 'You are a helpful assistant.',
    autoTurn: true,
    check_image_generation: true // Enable automatic image generation
  }
});

// The SDK handles the entire flow automatically
client.chat.send("Show me a picture of a sunset");
// 1. AI responds with text + image_prompt
// 2. Conversational turns process the text (if multi-sentence)
// 3. Image is generated automatically
// 4. Image context is added to chat history
// 5. Follow-up request is sent if AI indicated more content
```

### Follow-Up Request Handling

When the AI indicates more content is expected (`next: true` in response), the SDK:
1. **Waits for conversational turns** to complete (if any)
2. **Waits for image generation** to complete (if any)
3. **Sends automatic follow-up request** with existing conversation context

```javascript
// Follow-up requests are handled automatically
// No need to send [CONTINUE] messages manually
client.chat.send("Tell me a story");
// AI might respond with first part and next: true
// SDK automatically requests continuation
// Process repeats until AI indicates completion
```

### Message History Management

The SDK maintains perfect conversation context by:
- **Preserving all messages** including those with compliance violations
- **Maintaining chronological order** with proper timestamps
- **Grouping conversational turns** appropriately for API requests
- **Including compliance metadata** for client decision-making

```javascript
// Access chat history
const history = client.chat.getChatHistory();
console.log('Conversation history:', history);

// Messages with compliance violations are preserved with metadata
history.forEach(message => {
  if (message.compliance_violations) {
    console.log('Message has violations:', message.compliance_violations);
    // Client can decide how to handle in UI
  }
});
```

## Best Practices

### Configuration Tuning

- **splitProbability**:
  - `1.0` for maximum natural feel
  - `0.7-0.9` for balanced approach
  - `0.3-0.6` for more cohesive responses
  
- **baseTypingSpeed**:
  - `40-50 WPM` for relaxed conversation
  - `50-60 WPM` for normal pace
  - `60+ WPM` for faster interaction

- **speedVariation**:
  - `0.2-0.3` for subtle variation
  - `0.3-0.4` for more human-like feel
  - `>0.4` may feel too erratic

- **Delays**:
  - Keep `minDelay` ≥ 500ms for readability
  - Keep `maxDelay` ≤ 4000ms to avoid user impatience
  - Adjust based on your application's pace

### UI Integration

```javascript
// Show typing indicators for all message types
client.on('messageStart', (data) => {
  if (data.messageType === 'auto') {
    showTypingIndicator(`Turn ${data.turnIndex + 1}/${data.totalTurns}`);
  } else if (data.messageType === 'followup') {
    showTypingIndicator('Continuing...');
  } else {
    showTypingIndicator('Thinking...');
  }
});

client.on('messageComplete', (data) => {
  hideTypingIndicator();
  displayMessage(data.content);
  
  // Clean up when all messages are complete
  if (data.totalMessages) {
    enableUserInput();
    updateUIState('ready');
  }
});

client.on('messageError', (data) => {
  hideTypingIndicator();
  if (data.messageType === 'auto' && data.error.includes('Canceled')) {
    // User interrupted auto-turn, this is normal
    enableUserInput();
  } else {
    showErrorMessage(data.error);
  }
});

// Handle image generation feedback
client.on('imageGenerationStart', (data) => {
  showImageLoadingIndicator();
});

client.on('imageGenerationComplete', (data) => {
  hideImageLoadingIndicator();
  displayImage(data.imageUrl);
});
```
});
```

## Example Usage

```javascript
const client = new AnimusClient({
  tokenProviderUrl: 'http://localhost:3001/token',
  chat: {
    model: 'animafmngvy7-xavier-r1',
    systemMessage: 'You are a helpful assistant.',
    autoTurn: true
  }
});

// Set up event listeners
client.on('conversationalTurnStart', (data) => {
  showTypingIndicator(`Turn ${data.turnIndex + 1}/${data.totalTurns}`);
});

client.on('conversationalTurnComplete', (data) => {
  hideTypingIndicator();
  displayMessage(data.content);
});

client.on('conversationalTurnsCanceled', (data) => {
  hideTypingIndicator();
  console.log(`Interrupted: ${data.canceledTurns} messages canceled`);
});

// Send a message
client.chat.send(
  "Tell me about renewable energy sources and their benefits."
);
```

## How It Works

1. **Response Analysis**: When a response is received, the system analyzes it for sentence boundaries
2. **Split Decision**: Based on the split probability (60% default), decides whether to split the response
3. **Intelligent Grouping**: 
   - First sentence always goes alone
   - Subsequent short sentences (≤30 chars) are grouped together
   - Long sentences start new groups
4. **Delay Calculation**: Calculates realistic typing delays based on:
   - Word count and typing speed (45 WPM default)
   - Random variation (±20%)
   - Length factor (longer messages = slower typing)
5. **Queue Management**: Messages are queued with delays and processed sequentially
6. **Cancellation**: When user sends a new message, pending turns are canceled

## Sentence Detection

The feature includes sophisticated sentence detection that handles:
- **Abbreviations**: Dr., Mr., Mrs., etc., i.e., e.g.
- **Technical notation**: Object.method(), URLs, IP addresses
- **Version numbers**: v1.2.3, Node.js 18.0.1
- **Decimal numbers**: 3.14, $29.99
- **File extensions**: .js, .html, .json
- **Multiple languages**: Spanish ¿¡, French guillemets
- **Quoted text**: "Hello world."
- **Parenthetical text**: (see page 3.2)

## Backward Compatibility

- **Disabled by default**: No impact on existing code
- **Zero performance overhead**: When disabled, no processing occurs
- **Existing APIs unchanged**: All current functionality works exactly as before

## Advanced Configuration

While the simple `autoTurn: boolean` covers most use cases, the underlying system supports advanced configuration through the modular architecture:

```javascript
// The feature internally uses these configurable parameters:
const advancedConfig = {
  enabled: true,
  splitProbability: 0.6,        // 60% chance to split
  shortSentenceThreshold: 30,   // Characters
  baseTypingSpeed: 45,          // WPM
  speedVariation: 0.2,          // ±20%
  minDelay: 800,               // ms
  maxDelay: 4000               // ms
};
```

## Testing

Use the provided test file to verify the feature:

```bash
# Open the browser test page
open examples/test-conversational-turns.html
```

This will demonstrate:
- Multi-turn message splitting
- Event emission
- Cancellation when interrupted
- Real-time event logging in the browser

## Architecture

The feature is implemented as a modular system:
- `ResponseSplitter`: Analyzes and splits responses
- `MessageQueue`: Manages delays and cancellation
- `ConversationalTurnsManager`: Orchestrates the entire process
- `SentenceExtractor`: Handles complex sentence detection
- `DelayCalculator`: Computes realistic typing delays

This modular design ensures maintainability and allows for future enhancements.