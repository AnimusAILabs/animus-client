# Animus Client SDK (Browser) 

[![npm version](https://badge.fury.io/js/animus-client.svg)](https://badge.fury.io/js/animus-client) <!-- Placeholder badge -->

Unified AI platform combining text, vision, image generation, and tools in one simple SDK. Build powerful AI conversations with minimal code.

Skip the complexity of managing multiple AI services - instead of setting up separate cloud infrastructure for vision models, speech processing, language generation, and image creation, the Animus SDK handles it all for you in minimal code.

📖 **[View Full Documentation](https://docs.animusai.co)** - Complete API reference, guides, and examples

## Features

*   Easy integration into browser-based applications.
*   Secure authentication handling via a user-provided Token Proxy.
*   Methods for Chat Completions (including streaming).
*   Methods for Media Completions (Vision).
*   Methods for Media Analysis (Vision), including polling for video results.
*   Typed interfaces for requests and responses (TypeScript).
*   Configurable token storage (`sessionStorage` or `localStorage`).
*   Optional real-time communication via LiveKit Observer for low-latency streaming.
*   Automatic extraction of `<think>...</think>` blocks from assistant messages into a `reasoning` field for cleaner history and UI flexibility.
*   **Conversational Turns**: Natural conversation flow with automatic response splitting and realistic typing delays.
*   **Advanced Conversational Turns Configuration**: Granular control over split probability, typing speeds, delays, and sentence thresholds.
*   **Automatic Image Generation**: Seamless image generation when responses contain image prompts, with comprehensive event feedback.
*   **Image Modification**: Modify existing images using text prompts with the same unified API as image generation.
*   **Smart Follow-Up Requests**: Automatic continuation of conversations when the AI indicates more content is expected.
*   **Event-Driven Architecture**: Comprehensive events for all operations including turns, image generation, and message processing.
*   **Robust Message History**: Complete conversation context preservation, including messages with compliance violations for better AI context.

## Installation

```bash
npm install animus-client
# or
yarn add animus-client
```

## Prerequisites: Secure Token Endpoint

**Important:** To maintain security, this SDK does **not** handle your organization's Animus API key directly in the browser. You **must** create a secure backend endpoint (referred to as the `tokenProviderUrl` in the SDK configuration) that:

1.  Securely stores your organization's unique **Animus API key**.
2.  Receives a request from this SDK. (Your backend might perform its own user authentication here).
3.  Calls the central **Animus Auth Service** (`https://api.animusai.co/auth/generate-token`) using your stored Animus API key in the `apikey` header.
4.  Receives the JWT from the Animus Auth Service.
5.  Returns *only* the received JWT to the SDK in a JSON format like:
   ```json
   {
     "accessToken": "jwt_token_received_from_animus"
   }
   ```
   *(The token's expiry is included within the JWT payload itself (`exp` claim) and is handled internally by the SDK).*

An example Node.js/Express implementation demonstrating how this backend endpoint can securely call the central Animus Auth Service is provided in the `/examples/auth-server` directory of this repository. This example acts as a secure intermediary.

## Usage

```typescript
import { AnimusClient, ChatMessage, ApiError, AuthenticationError } from 'animus-client';

// URL of YOUR backend Token Proxy endpoint
const tokenProviderUrl = 'https://your-backend.example.com/api/get-animus-token';

async function main() {
  try {
    const client = new AnimusClient({
      tokenProviderUrl: tokenProviderUrl,
      // Optional configurations:
      // apiBaseUrl: 'https://api.animusai.co/v3', // Defaults to v3
      // tokenStorage: 'localStorage', // Defaults to 'sessionStorage'
      // defaultChatModel: 'vivian-llama3.1-70b-1.0-fp8',
      // defaultMediaModel: 'animuslabs/Qwen2-VL-NSFW-Vision-1.2'
    });

    // --- Example: Chat Completion ---
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Write a haiku about AI.' }
    ];

    const chatResponse = await client.chat.completions({
      // model: 'vivian-...', // Use default or specify here
      messages: messages,
      temperature: 0.7
    });
    console.log('Chat Response:', chatResponse.choices[0].message.content);

    // --- Example: Streaming Chat Completion ---
    // Use AsyncIterable for streaming
    try {
      const stream = await client.chat.completions({
        messages: messages,
        stream: true
      });
      
      let fullContent = '';
      
      // Process each chunk as it arrives
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content || '';
        fullContent += delta;
        process.stdout.write(delta); // Update UI incrementally
      }
      
      console.log('\nStream finished. Full content:', fullContent);
    } catch (error) {
      console.error('\nStream error:', error);
    }

    // --- Example: Conversational Turns ---
    // Enable natural conversation flow with automatic response splitting
    const clientWithAutoTurn = new AnimusClient({
      tokenProviderUrl: tokenProviderUrl,
      chat: {
        model: 'vivian-llama3.1-70b-1.0-fp8',
        systemMessage: 'You are a helpful assistant.',
        autoTurn: true // Simple enable - uses default settings
      }
    });

    // --- Example: Advanced Conversational Turns Configuration ---
    const clientWithAdvancedAutoTurn = new AnimusClient({
      tokenProviderUrl: tokenProviderUrl,
      chat: {
        model: 'vivian-llama3.1-70b-1.0-fp8',
        systemMessage: 'You are a helpful assistant.',
        autoTurn: {
          enabled: true,
          splitProbability: 0.8,        // 80% chance to split multi-sentence responses
          baseTypingSpeed: 50,          // 50 WPM base typing speed
          speedVariation: 0.3,          // ±30% speed variation
          minDelay: 800,                // Minimum 800ms delay between turns
          maxDelay: 2500,               // Maximum 2.5s delay between turns
          maxTurns: 3                   // Maximum number of turns allowed
        }
      }
    });

    // Listen for unified message events
    clientWithAutoTurn.on('messageStart', (data) => {
      console.log(`Starting ${data.messageType} message: ${data.content}`);
      if (data.messageType === 'auto' && data.turnIndex !== undefined) {
        console.log(`Turn ${data.turnIndex + 1}/${data.totalTurns}`);
      }
    });

    clientWithAutoTurn.on('messageComplete', (data) => {
      console.log(`Completed ${data.messageType || 'regular'} message: ${data.content}`);
      if (data.messageType === 'auto' && data.turnIndex !== undefined) {
        console.log(`Turn ${data.turnIndex + 1}/${data.totalTurns} complete`);
      }
      if (data.totalMessages) {
        console.log(`All ${data.totalMessages} messages completed`);
      }
    });

    clientWithAutoTurn.on('messageError', (data) => {
      console.error(`${data.messageType || 'regular'} message error: ${data.error}`);
    });

    // Image generation events
    clientWithAutoTurn.on('imageGenerationStart', (data) => {
      console.log(`Starting image generation: ${data.prompt}`);
    });

    clientWithAutoTurn.on('imageGenerationComplete', (data) => {
      console.log(`Image generated: ${data.imageUrl}`);
    });

    clientWithAutoTurn.on('imageGenerationError', (data) => {
      console.error(`Image generation failed: ${data.error}`);
    });

    // Send message - may be split into multiple turns with natural delays
    clientWithAutoTurn.chat.send("Tell me about renewable energy sources and their benefits.");

    // --- Example: Direct Image Generation ---
    const newImageUrl = await client.generateImage("A futuristic cityscape at night");
    console.log('Generated image:', newImageUrl);

    // --- Example: Image Modification ---
    const modifiedImageUrl = await client.generateImage(
      "Convert to black and white with high contrast",
      "https://example.com/original-photo.jpg"
    );
    console.log('Modified image:', modifiedImageUrl);


    // --- Example: Media Analysis (Image) ---
    const imageAnalysis = await client.media.analyze({
        media_url: 'https://example.com/image.jpg',
        metadata: ['categories', 'tags']
    });
    console.log('Image Analysis:', imageAnalysis.metadata);

    // --- Example: Media Analysis (Video - starts polling) ---
    console.log('Starting video analysis...');
    const videoAnalysis = await client.media.analyze({
        media_url: 'https://example.com/video.mp4',
        metadata: ['categories', 'actions']
    });
    console.log('Video Analysis Results:', videoAnalysis.results);


  } catch (error) {
    if (error instanceof AuthenticationError) {
      console.error('Authentication failed:', error.message);
      // Handle auth errors (e.g., redirect to login, prompt for credentials)
    } else if (error instanceof ApiError) {
      console.error(`API Error (${error.status}):`, error.message, error.errorData);
      // Handle API errors (e.g., show error message to user)
    } else {
      console.error('An unexpected error occurred:', error);
    }
  }
}

main();
```

## API Documentation

This section details the core components and usage patterns of the Animus Client SDK.

### 1. Initialization (`AnimusClient`)

First, import and initialize the main client.

```typescript
import { AnimusClient } from 'animus-client';

const client = new AnimusClient({
  // Required:
  tokenProviderUrl: 'https://your-backend.server.com/api/get-animus-token',

  // Optional: Configure chat defaults (model & systemMessage required if chat object is present)
  chat: {
    // --- Required ---
    model: 'vivian-llama3.1-8b-1.0-fp8', // Required: Default model ID
    systemMessage: 'You are Animus, a helpful AI assistant.', // Required: Default system prompt

    // --- Optional API Parameter Defaults ---
    temperature: 0.7,
    // top_p: 1.0,          // Default: 1
    // n: 1,                // Default: 1 (Number of choices - typically 1 for chat)
    max_tokens: 500,        // No API default (model-specific), SDK sets example
    // stop: ["\n"],        // Default: null
    stream: false,          // Default: false
    // presence_penalty: 0.0,  // Default: 0 (API default is 1, but 0 is common practice)
    // frequency_penalty: 0.0, // Default: 0 (API default is 1, but 0 is common practice)
    // best_of: 1,          // Default: 1
    // top_k: 40,           // Default: 40
    // repetition_penalty: 1.0, // Default: 1
    // min_p: 0.0,          // Default: 0
    // length_penalty: 1.0, // Default: 1
    compliance: true,       // Default: true (Enables content moderation)
    reasoning: false,       // Default: false (When true, enables reasoning/thinking content from the model)

    // --- Optional SDK Specific ---
    historySize: 30         // Default: 0 (disabled) number of turns to send to the LLM for conversational context
  },

  // Optional: Configure vision defaults (model required if vision object is present)
  vision: {
    model: 'animuslabs/Qwen2-VL-NSFW-Vision-1.2', // Required if providing vision config
    // temperature: 0.2 // Optional vision default
  },


  // Optional: Other top-level settings
  // apiBaseUrl: 'https://api.animusai.co/v3',
  // tokenStorage: 'localStorage', // 'sessionStorage' is default
});
```

**Configuration (`AnimusClientOptions`):**

*   `tokenProviderUrl` (**required**, `string`): The URL of your secure backend endpoint that provides Animus access tokens.
*   `apiBaseUrl` (optional, `string`): Overrides the default Animus API endpoint (`https://api.animusai.co/v3`).
*   `tokenStorage` (optional, `'sessionStorage' | 'localStorage'`): Choose where to store the auth token (default: `'sessionStorage'`).
*   `chat` (optional, `AnimusChatOptions`): If provided, enables chat features and sets defaults for chat requests.
    *   `model` (**required**, `string`): Default model ID (e.g., `"animuslabs/Vivian-llama3.1-70b-1.0-fp8"`).
    *   `systemMessage` (**required**, `string`): Default system prompt.
    *   `temperature` (optional, `number`, default: 1): Controls randomness.
    *   `top_p` (optional, `number`, default: 1): Nucleus sampling threshold.
    *   `n` (optional, `number`, default: 1): Number of choices to generate.
    *   `max_tokens` (optional, `number`, no API default): Max tokens in response.
    *   `stop` (optional, `string[]`, default: null): Stop sequences.
    *   `stream` (optional, `boolean`, default: false): Enable streaming response.
    *   `presence_penalty` (optional, `number`, default: 1): Penalizes new words based on presence.
    *   `frequency_penalty` (optional, `number`, default: 1): Penalizes words based on frequency.
    *   `best_of` (optional, `number`, default: 1): Server-side generations for best result.
    *   `top_k` (optional, `number`, default: 40): Limits sampling to top k tokens.
    *   `repetition_penalty` (optional, `number`, default: 1): Penalizes repeating tokens.
    *   `min_p` (optional, `number`, default: 0): Minimum probability threshold for tokens.
    *   `length_penalty` (optional, `number`, default: 1): Adjusts impact of sequence length.
    *   `compliance` (optional, `boolean`, default: true): Enables content moderation (see **Content Compliance** section below).
    *   `reasoning` (optional, `boolean`, default: false): For non-streaming responses, this adds a `reasoning` field to the response message. For streaming, the thinking content will be included directly in the response stream.
    *   `check_image_generation` (optional, `boolean`, default: false): When true, checks if the response contains an `image_prompt` and automatically generates an image (see **Image Generation** section below).
    *   `historySize` (optional, `number`, default: 0): Enables automatic chat history management (SDK feature).
    *   `autoTurn` (optional, `boolean | ConversationalTurnsConfig`, default: false): Enables conversational turns with natural response splitting and typing delays. **Note:** Streaming is not supported when autoTurn is enabled.
        *   Simple usage: `autoTurn: true` (uses default settings)
        *   Advanced usage: `autoTurn: { enabled: true, splitProbability: 0.8, ... }` (see **Conversational Turns Configuration** below)
*   `vision` (optional, `AnimusVisionOptions`): If provided, enables vision features and sets defaults.
    *   `model` (**required** if `vision` provided, `string`): Default model for vision requests.
    *   `temperature` (optional, `number`): Default temperature for vision *completion* requests.

---

### 2. Chat (`client.chat`)

Interact with chat models. Accessed via `client.chat`. Requires `chat` options to be configured during client initialization.

#### When to Use Which Method

The chat module provides two main methods for different use cases:

**Use `chat.send()` when:**
- Building conversational interfaces or chatbots
- You want automatic chat history management
- You need conversational turns (natural response splitting)
- You prefer event-driven responses for real-time UI updates
- You want automatic follow-up request handling
- You're building simple chat applications

**Use `chat.completions()` when:**
- You need full control over the request parameters
- You want to handle responses synchronously
- You're building non-conversational AI features (analysis, generation, etc.)
- You need to send multiple messages at once
- You want to manage chat history manually
- You're integrating with existing systems that expect direct responses
- You need streaming with custom chunk processing

#### Quick Examples

```typescript
// Use chat.send() for conversational interfaces
client.on('messageComplete', (data) => {
  console.log('AI:', data.content);
  updateChatUI(data.content);
});
client.chat.send("Hello, how are you?");

// Use chat.completions() for direct API calls
const response = await client.chat.completions({
  messages: [
    { role: 'system', content: 'Analyze the following text for sentiment.' },
    { role: 'user', content: 'I love this product!' }
  ]
});
console.log('Analysis:', response.choices[0].message.content);
```

**ChatMessage Interface:**

```typescript
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null; // The displayable content of the message (can be null for tool_calls)
  name?: string;
  reasoning?: string; // Content extracted from the first <think>...</think> block (if any)
  timestamp?: string; // ISO timestamp when message was created
  tool_calls?: ToolCall[]; // For assistant messages requesting a tool call
  tool_call_id?: string; // For tool messages responding to a tool call
  compliance_violations?: string[]; // Track compliance violations for context
  // Group metadata for conversational turns (internal use)
  groupId?: string;
  messageIndex?: number;
  totalInGroup?: number;
}
```
*   **Note on `reasoning`:** If an assistant message contains `<think>...</think>` tags, the SDK automatically extracts the content of the *first* block into the `reasoning` field and removes the block (including tags) from the `content` field before storing it in history. This `reasoning` field is *not* sent back to the API in subsequent requests, helping to manage context window size.
*   **Note on `compliance_violations`:** Messages with compliance violations are preserved in history with violation metadata to maintain conversation context. Individual clients can decide how to handle these messages in their UI.
*   **Note on group metadata:** The `groupId`, `messageIndex`, and `totalInGroup` fields are used internally by conversational turns to track message relationships and are automatically managed by the SDK.

**a) Simple Send (`client.chat.send`)**

The easiest way to have a conversation. Sends a single user message and gets a response, using configured defaults and history.

```typescript
import { ApiError, AuthenticationError } from 'animus-client';

// Assumes client was initialized with chat options (model, systemMessage)
// Set up event listeners for responses
client.on('messageComplete', (data) => {
  console.log("AI Response:", data.content);
  // Check compliance violations if needed: data.compliance_violations
});

client.on('messageError', (data) => {
  console.error("Message Error:", data.error);
});

// Send message - responses handled through events
client.chat.send(
  "Tell me about the Animus Client SDK.",
  { // Optional overrides for this specific request
    temperature: 0.8,
    reasoning: true, // Enable reasoning to see the model's thinking process
    // model: 'specific-model-override' // Can override model here too
  }
);
```

**b) Full Completions (`client.chat.completions`)**

Provides more control, allowing you to send multiple messages at once and optionally stream the response. Uses configured defaults unless overridden.

```typescript
import { ChatMessage } from 'animus-client';

// Assumes client was initialized with chat options (model, systemMessage)
const messages: ChatMessage[] = [
  // System message is added automatically from config
  { role: 'user', content: 'Write a short poem about Javascript.' }
];

// Non-streaming:
try {
  const response = await client.chat.completions({
    messages: messages,
    model: 'override-model-if-needed', // Optional: overrides configured default
    max_tokens: 100, // Optional override
    stream: false, // Explicitly non-streaming
    reasoning: true // Enable reasoning to see the model's thinking process
  });
  console.log("AI Poem:", response.choices[0].message.content);
  
  // Access reasoning content if available
  if (response.choices[0].message.reasoning) {
    console.log("Reasoning:", response.choices[0].message.reasoning);
  }
  
  // Check compliance violations if needed: response.compliance_violations
} catch (error) { /* ... */ }

// Streaming (AsyncIterable-based):
try {
  const stream = await client.chat.completions({
    messages: messages,
    stream: true, // Enable streaming
    reasoning: true // Enable reasoning to see the model's thinking process in the stream
  });
  
  let fullContent = '';
  
  // Process each chunk as it arrives
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || '';
    fullContent += delta;
    console.log("Content so far:", fullContent);
  }
  
  console.log("Stream complete. Final content:", fullContent);
  console.log("Note: When streaming with reasoning enabled, thinking content will appear directly in the stream");
} catch (error) { /* ... */ }
```

*   **Key Types:** `ChatMessage` (see above), `ChatCompletionRequest`, `ChatCompletionResponse`, `ChatCompletionChunk`.
*   **History & Reasoning:** When `historySize` > 0, the SDK automatically includes previous messages (excluding the `reasoning` field) in the request. When processing responses (streaming or non-streaming), `<think>` tags are extracted into the `reasoning` field before the message is added to history.

**c) Chat History Management**

The SDK provides methods to manipulate the conversation history directly:

```typescript
// Get copy of current chat history
const history = client.chat.getChatHistory();

// Replace entire history
const importCount = client.chat.setChatHistory(savedConversation, true);

// Update a specific message
const updateSuccess = client.chat.updateHistoryMessage(2, { content: "Updated" });

// Delete a specific message
const deleteSuccess = client.chat.deleteHistoryMessage(3);

// Clear all history
const clearedCount = client.chat.clearChatHistory();
```

---

### 3. Content Compliance (Chat Moderation)

The Animus API integrates content moderation via the `compliance` parameter.

*   **Enabling:** Set `compliance: true` during client initialization (default) or in a specific request.
*   **Disabling:** Set `compliance: false`.
*   **Response:** When enabled and violations are detected in **non-streaming** responses, the `ChatCompletionResponse` will include a `compliance_violations` field (e.g., `["drug_use", "gore"]`).
*   **Streaming:** Content moderation (`compliance: true`) is **not supported for streaming requests** (HTTP or Observer). The `compliance` flag is ignored, and no `compliance_violations` will be returned via `streamChunk` or `streamComplete` events.
*   **History:** Responses with compliance violations are **added to the internal conversation history** with violation metadata to maintain conversation context for the AI. Individual clients can decide how to handle these messages in their UI.

#### Non-streaming Compliance Detection

```typescript
// Using send() - responses handled through events
client.on('messageComplete', (data) => {
  if (data.compliance_violations?.length > 0) {
    console.warn("Content violations detected:", data.compliance_violations);
  } else {
    console.log("AI:", data.content);
  }
});

client.chat.send("Some potentially non-compliant text.");

// Using completions()
const responseComp = await client.chat.completions({
  messages: [{ role: 'user', content: 'Some potentially non-compliant text.' }],
  stream: false, // Ensure stream is false
  compliance: true // Ensure compliance is true
});
if (responseComp.compliance_violations && responseComp.compliance_violations.length > 0) {
  console.warn("Content violations detected:", responseComp.compliance_violations);
} else {
  console.log("AI:", responseComp.choices[0].message.content);
}
```

*   **Violation Categories:** `pedophilia`, `beastiality`, `murder`, `rape`, `incest`, `gore`, `prostitution`, `drug_use`.
*   **Best Practices:** Keep `compliance: true` (default); implement user-friendly handling; consider client-side filtering; review flagged content.

---

### 4. Conversational Turns Configuration

The SDK provides advanced conversational turns functionality that creates natural conversation flow by automatically splitting long responses into multiple messages with realistic typing delays.

> **⚠️ Important:** Streaming (`stream: true`) is not supported when conversational turns (`autoTurn`) is enabled. The SDK will automatically use non-streaming mode for requests when autoTurn is active.

#### Basic Usage

```typescript
// Simple enable - uses default settings
const client = new AnimusClient({
  tokenProviderUrl: 'your-token-url',
  chat: {
    model: 'your-model',
    systemMessage: 'You are a helpful assistant.',
    autoTurn: true // Enable with defaults
  }
});
```

#### Advanced Configuration

```typescript
// Advanced configuration with custom settings
const client = new AnimusClient({
  tokenProviderUrl: 'your-token-url',
  chat: {
    model: 'your-model',
    systemMessage: 'You are a helpful assistant.',
    autoTurn: {
      enabled: true,                    // Enable conversational turns
      splitProbability: 0.8,           // 80% chance to split multi-sentence responses
      baseTypingSpeed: 50,             // Base typing speed in WPM (words per minute)
      speedVariation: 0.3,             // ±30% speed variation for natural feel
      minDelay: 800,                   // Minimum delay between turns (ms)
      maxDelay: 2500,                  // Maximum delay between turns (ms)
      maxTurns: 3,                     // Maximum number of turns allowed (including hasNext)
      followUpDelay: 2000,             // Delay before sending follow-up requests (ms)
      maxSequentialFollowUps: 2        // Maximum sequential follow-ups allowed before requiring user input
    }
  }
});
```

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable conversational turns |
| `splitProbability` | `number` | `0.6` | Probability (0-1) of splitting responses (overridden by newlines) |
| `baseTypingSpeed` | `number` | `45` | Base typing speed in words per minute |
| `speedVariation` | `number` | `0.2` | Speed variation factor (±percentage) |
| `minDelay` | `number` | `500` | Minimum delay between turns in milliseconds |
| `maxDelay` | `number` | `3000` | Maximum delay between turns in milliseconds |
| `maxTurns` | `number` | `3` | Maximum number of turns allowed (including hasNext flag) |
| `followUpDelay` | `number` | `2000` | Delay in milliseconds before sending follow-up requests |
| `maxSequentialFollowUps` | `number` | `2` | Maximum sequential follow-ups allowed before requiring user input |

#### Events

The SDK uses a unified event system where all messages (regular, auto-turn, and follow-up) emit the same events:

```typescript
// Unified message events for all message types
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

// Image generation events (when responses include image prompts)
client.on('imageGenerationStart', (data) => {
  console.log(`Starting image generation: ${data.prompt}`);
});

client.on('imageGenerationComplete', (data) => {
  console.log(`Image generated: ${data.imageUrl}`);
});

client.on('imageGenerationError', (data) => {
  console.error(`Image generation failed: ${data.error}`);
});
```

**Message Types:**
- `regular`: Standard user-initiated messages and responses
- `auto`: Messages from conversational turns (split responses)
- `followup`: Automatic follow-up requests when AI indicates more content

#### How It Works

1. **Response Analysis**: When a response is received, it's analyzed for potential splitting
2. **Priority-Based Processing**: The system follows a clear priority order:
   - **Priority 1**: If autoTurn is enabled AND content has newlines → **ALWAYS** split on newlines (ignores probability and pre-split turns)
   - **Priority 2**: If no newlines but pre-split turns are available → Apply `splitProbability` to decide whether to use them
   - **Priority 3**: Otherwise → Process normally without splitting
3. **Turn Limiting**: If splitting would exceed `maxTurns` (including hasNext flag), turns are intelligently concatenated using a 70% probability with natural variation
4. **Delay Calculation**: Realistic typing delays are calculated based on content length and typing speed
5. **Sequential Delivery**: Messages are delivered with natural delays, creating conversational flow
6. **Coordination**: Image generation and follow-up requests are properly coordinated with turn completion

#### Best Practices

- **splitProbability**: Use 0.7-1.0 for natural conversation, lower values for more cohesive responses
- **baseTypingSpeed**: 40-60 WPM feels natural for most users
- **speedVariation**: 0.2-0.4 adds realistic human-like variation
- **Delays**: Keep minDelay ≥ 500ms and maxDelay ≤ 4000ms for good UX

#### Follow-Up Request Management

The SDK includes intelligent follow-up request management to prevent infinite loops while maintaining natural conversation flow:

- **Sequential Limiting**: `maxSequentialFollowUps` (default: 2) limits how many follow-up requests can occur in a row before requiring user input
- **Image Generation Protection**: Follow-up requests are automatically blocked immediately after image generation to prevent loops
- **Configurable Delay**: `followUpDelay` (default: 2000ms) controls the natural pause before follow-up requests
- **User Reset**: All follow-up counters and flags are reset when the user sends a new message

**Example Configuration:**
```typescript
autoTurn: {
  enabled: true,
  followUpDelay: 1500,        // 1.5 second delay before follow-ups
  maxSequentialFollowUps: 1   // Allow only 1 follow-up before requiring user input
}
```

#### Message Cancellation

The SDK automatically handles message cancellation when users send new messages while previous operations are still in progress. This ensures clean conversation flow and prevents out-of-order responses.

**Automatic Cancellation Behavior:**

- **Conversational Turns**: When a user sends a new message while conversational turns are being processed, any pending (unprocessed) turns are automatically canceled
- **Follow-Up Requests**: Pending follow-up requests are canceled when a new user message is sent
- **History Preservation**: Already-processed messages remain in chat history to maintain conversation context
- **Clean State**: The SDK ensures no orphaned responses appear after user interruption

**Example Scenario:**
```typescript
// User sends a message that triggers conversational turns
client.chat.send("Tell me about renewable energy");

// While turns are being processed, user sends another message
client.chat.send("Actually, tell me about solar panels instead");

// Result:
// - Any unprocessed turns from the first message are canceled
// - Already-processed turns remain in history
// - The second message is processed normally
// - No out-of-order responses occur
```

**Events During Cancellation:**
```typescript
client.on('messageError', (data) => {
  if (data.messageType === 'auto' && data.error.includes('Canceled')) {
    console.log('Auto-turn messages were canceled due to new user input');
  }
  
  if (data.messageType === 'followup' && data.error.includes('Canceled')) {
    console.log('Follow-up request was canceled due to new user input');
  }
});
```

This cancellation system works automatically and requires no configuration. It ensures that users always receive relevant, timely responses without confusion from delayed or out-of-order messages.

---

### 5. Media / Vision (`client.media`)

Interact with vision models. Accessed via `client.media`. Requires `vision` options (with `model`) to be configured during client initialization to use configured defaults.

**a) Media Completions (`client.media.completions`)**

Ask questions about images.

```typescript
import { MediaMessage } from 'animus-client';

const visionMessages: MediaMessage[] = [
  { role: 'user', content: [
    { type: 'text', text: 'Describe this image.' },
    { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
  ]}
];
const response = await client.media.completions({ messages: visionMessages });
console.log("Vision Response:", response.choices[0].message.content);
```

*   **Key Types:** `MediaMessage`, `MediaCompletionRequest`, `MediaCompletionResponse`.

**b) Media Analysis (`client.media.analyze`)**

Extract metadata from images or videos.

```typescript
// Image Analysis
const imageAnalysis = await client.media.analyze({
  media_url: 'https://example.com/image.jpg',
  metadata: ['categories', 'tags']
});
console.log('Image Categories:', imageAnalysis.metadata?.categories);

// Video Analysis (starts polling)
const videoAnalysis = await client.media.analyze({
  media_url: 'https://example.com/video.mp4',
  metadata: ['actions', 'scene']
});
console.log('Video Actions:', videoAnalysis.results?.[0]?.actions);
```

*   **Key Types:** `MediaAnalysisRequest`, `MediaAnalysisResultResponse`.

**c) Get Analysis Status (`client.media.getAnalysisStatus`)**

Manually check the status of a video analysis job.

```typescript
const jobId = 'some_job_id_from_analyze';
const status = await client.media.getAnalysisStatus(jobId);
console.log(`Job ${jobId} Status: ${status.status}, Progress: ${status.percent_complete}%`);
```

*   **Key Type:** `MediaAnalysisStatusResponse`.

---

### 5. Authentication (`client.clearAuthToken`)

Manually clear the stored authentication token.

```typescript
client.clearAuthToken();
```

---

### 6. Streaming Implementation

For HTTP streaming responses, the SDK uses the **AsyncIterable** pattern:

```typescript
// Using AsyncIterable pattern for streaming
try {
  // Get a stream of chunks
  const stream = await client.chat.completions({
    messages: [{ role: 'user', content: 'Hello!' }],
    stream: true
  });

  let fullContent = '';

  // Process each chunk with standard async/await syntax
  for await (const chunk of stream) {
    // Extract content delta
    const delta = chunk.choices?.[0]?.delta?.content || '';
    
    // Accumulate content
    fullContent += delta;
    
    // Update UI incrementally
    console.log('Content so far:', fullContent);
  }
  
  // Stream completed successfully
  console.log('Final content:', fullContent);
} catch (error) {
  // Handle any streaming errors
  console.error('Stream error:', error);
}
```

---

### 7. Image Generation and Modification

The SDK provides unified support for both generating new images from text prompts and modifying existing images. This can be triggered directly or through the chat completion response.

#### a) Direct Image Generation (`client.generateImage`)

Generate a new image from a text prompt:

```javascript
// Generate a new image from a prompt
try {
  const imageUrl = await client.generateImage("A serene mountain landscape at sunset");
  console.log('Generated image URL:', imageUrl);
} catch (error) {
  console.error('Image generation failed:', error);
}
```

#### b) Image Modification (`client.generateImage`)

Modify an existing image using the same method by providing an input image URL:

```javascript
// Modify an existing image
try {
  const modifiedImageUrl = await client.generateImage(
    "Make this a 90s cartoon style",
    "https://example.com/input-image.jpg"
  );
  console.log('Modified image URL:', modifiedImageUrl);
} catch (error) {
  console.error('Image modification failed:', error);
}
```

The `generateImage` method:
- **Text-to-Image**: When only a prompt is provided, generates a new image
- **Image Modification**: When both prompt and input image URL are provided, modifies the existing image
- Makes an API request to the appropriate image processing endpoint
- Adds the result to chat history automatically
- Returns the image URL directly
- Uses the same events for both generation and modification operations

#### b) Automatic Image Generation via Chat

When you set `check_image_generation: true`, the SDK automatically handles the entire image generation process:

```javascript
const response = await client.chat.completions({
  messages: [{ role: 'user', content: 'Create an image of a futuristic city' }],
  check_image_generation: true // Enable automatic image generation
});

// The SDK automatically:
// 1. Detects if the model included an image_prompt in the response
// 2. Generates the image using that prompt
// 3. Adds the image to chat history
// 4. Emits imageGeneration events for UI feedback
```

The SDK handles everything automatically, including:
- **Image generation**: When the model includes an `image_prompt`, the image is generated automatically
- **Event emission**: `imageGenerationStart`, `imageGenerationComplete`, and `imageGenerationError` events
- **Chat history**: The generated image is automatically added to conversation history
- **Error handling**: Failed image generation is handled gracefully with error events

#### c) Image Response Format

When an image is generated, it is automatically added to the chat history as an assistant message with this format:

```html
<image description='The image prompt text' />
```

This provides the AI with context about the image that was generated and displayed to the user.

---

### 8. Error Handling

The SDK throws specific error types:

*   `AuthenticationError`: Issues related to fetching or validating the access token (e.g., invalid `tokenProviderUrl`, token expiry).
*   `ApiError`: Errors returned directly from the Animus API (e.g., invalid request parameters, model errors, image generation failures). Includes `status` code and `errorData`.
*   Standard `Error`: For other issues like network problems or configuration errors.

Use `try...catch` blocks and check the error type using `instanceof`.

```typescript
try {
  // SDK call...
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error('Auth Error:', error.message);
  } else if (error instanceof ApiError) {
    console.error(`API Error (${error.status}):`, error.message, error.errorData);
  } else {
    console.error('Unexpected Error:', error);
  }
}
```

---

## Automated Releases

This project uses `semantic-release` for automated versioning and package publishing. Commits following the [Conventional Commits specification](https://www.conventionalcommits.org/) trigger releases based on the commit type (`fix:` for patches, `feat:` for minor versions, `BREAKING CHANGE:` for major versions).

## Development

1.  Clone the repository.
2.  Install dependencies: `npm install`
3.  Build the SDK: `npm run build` (outputs to `dist/`)
4.  Run tests: `npm test`

### Quick Demo

Run the complete demo with one command:

```bash
npm run demo
```

This command will:
- Build the latest SDK
- Start the example auth server on `http://localhost:3001`
- Start a web server on `http://localhost:8080`
- Automatically open the demo in your browser

The demo includes:
- Interactive chat interface with all SDK features
- Image generation and modification testing
- Conversational turns configuration
- Real-time event monitoring

### Manual Setup

Alternatively, you can run components separately:

1. Run example auth server: `cd examples/auth-server && npm install && npm start`
2. Open `examples/test-sdk/index.html` in your browser to test the SDK.
