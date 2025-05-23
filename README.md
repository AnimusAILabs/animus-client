# Animus Client SDK (Browser)

[![npm version](https://badge.fury.io/js/animus-client.svg)](https://badge.fury.io/js/animus-client) <!-- Placeholder badge -->

A Javascript SDK for interacting with the Animus AI API from browser environments.

This SDK simplifies authentication and provides convenient methods for accessing Animus AI services like Chat Completions and Media Analysis (Vision).

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

  // Optional: Configure Observer connection
  observer: {
      enabled: true // Set to true to enable Observer feature
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
*   `vision` (optional, `AnimusVisionOptions`): If provided, enables vision features and sets defaults.
    *   `model` (**required** if `vision` provided, `string`): Default model for vision requests.
    *   `temperature` (optional, `number`): Default temperature for vision *completion* requests.
*   `observer` (optional, `AnimusObserverOptions`): Configures the LiveKit Observer connection for real-time communication.
    *   `enabled` (**required** if `observer` provided, `boolean`): Set to `true` to enable the observer feature.
    *   The following parameters configure the observer agent's behavior and are sent to the backend (all values optional):
      * `initial_inactivity_delay` (optional, `number`, default: 120): Seconds before the first inactivity check.
      * `backoff_multiplier` (optional, `number`, default: 1.5): Multiplier for increasing the delay between subsequent inactivity checks.
      * `max_inactivity_messages` (optional, `number`, default: 2): Maximum number of inactivity messages to send during a period of user inactivity.

---

### 2. Chat (`client.chat`)

Interact with chat models. Accessed via `client.chat`. Requires `chat` options to be configured during client initialization.

**ChatMessage Interface:**

```typescript
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string; // The displayable content of the message
  name?: string;
  reasoning?: string; // Content extracted from the first <think>...</think> block (if any)
}
```
*   **Note on `reasoning`:** If an assistant message contains `<think>...</think>` tags, the SDK automatically extracts the content of the *first* block into the `reasoning` field and removes the block (including tags) from the `content` field before storing it in history. This `reasoning` field is *not* sent back to the API in subsequent requests, helping to manage context window size.

**a) Simple Send (`client.chat.send`)**

The easiest way to have a conversation. Sends a single user message and gets a response, using configured defaults and history.

```typescript
import { ApiError, AuthenticationError } from 'animus-client';

// Assumes client was initialized with chat options (model, systemMessage)
try {
  // If Observer is connected, this returns void and response comes via observer events.
  // If Observer is NOT connected, this returns the ChatCompletionResponse directly.
  const response = await client.chat.send(
    "Tell me about the Animus Client SDK.",
    { // Optional overrides for this specific request (used only in HTTP fallback)
      temperature: 0.8,
      reasoning: true, // Enable reasoning to see the model's thinking process
      // model: 'specific-model-override' // Can override model here too
    }
  );

  if (response) { // Handle the direct HTTP response if Observer wasn't connected
      console.log("AI (HTTP Fallback):", response.choices[0].message.content);
      // Check compliance violations if needed: response.compliance_violations
  } else {
      console.log("Message sent via Observer. Waiting for stream events...");
  }

} catch (error) {
  // Handle errors (see Error Handling section)
  if (error instanceof ApiError) console.error("API Error:", error.message);
  else console.error("Error:", error);
}
```
*   **Behavior:** If the LiveKit Observer is enabled and connected (see Section 5), `send()` routes the message via the observer, returns `undefined` immediately, and the response arrives via observer events like `observerComplete`. If the observer is not connected, `send()` falls back to a standard non-streaming HTTP request and returns the `ChatCompletionResponse`.

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
*   **History:** Responses with compliance violations (from non-streaming requests) are automatically **not** added to the internal conversation history.

#### Non-streaming Compliance Detection

```typescript
// Using send() (always non-streaming if it returns a response)
const response = await client.chat.send("Some potentially non-compliant text.");
if (response?.compliance_violations?.length > 0) { // Check if response exists and has violations
  console.warn("Content violations detected:", response.compliance_violations);
} else if (response) {
  console.log("AI:", response.choices[0].message.content);
}

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

### 4. Media / Vision (`client.media`)

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

Manually clear the stored authentication token. Also disconnects the observer if connected.

```typescript
client.clearAuthToken();
```

---

### 6. LiveKit Observer & Unified Streaming Events

The SDK includes optional support for real-time, low-latency communication with compatible Animus agents using LiveKit. When enabled, the SDK attempts to route chat messages (`client.chat.send`) via this connection.

**a) Enabling the Observer**

Provide the `observer` configuration object with `enabled: true` during client initialization:

```typescript
const client = new AnimusClient({
  tokenProviderUrl: '...',
  chat: { /* ... */ },
  observer: {
    enabled: true // Enable the observer feature
  }
  // ... other options
});
```

After each AI assistant response, the SDK automatically sends the conversation history to the observer agent, which may decide to send proactive messages to re-engage inactive users.

**b) Connection Management**

The SDK manages the LiveKit connection lifecycle internally when `observer.enabled` is `true`. You **must manually initiate** the connection after creating the client:

*   **Manual Connection:** `await client.connectObserverManually();`
*   **Manual Disconnection:** `await client.disconnectObserverManually();`
*   **Connection Status Events:** Listen for `observerConnecting`, `observerConnected`, `observerDisconnected`, `observerReconnecting`, `observerReconnected`, and `observerError` events on the `client` instance to track the connection state.

**c) Streaming Implementation**

For HTTP streaming responses, the SDK now uses the **AsyncIterable** pattern instead of events:

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

// --- Observer Events ---

// Import the observer event data types
import {
  ObserverChunkData,
  ObserverCompleteData,
  ObserverErrorData,
  ObserverSessionEndedData
} from 'animus-client';

// The observer uses a different set of events
// Each event type has its own data structure

// ObserverChunkData is emitted during streaming from the observer
client.on('observerChunk', (data: ObserverChunkData) => {
  // data contains:
  // - participantIdentity: string - ID of the participant sending the chunk
  // - chunk: ChatCompletionChunk - The raw chunk object
  // - deltaContent?: string - Content delta from the chunk (if any)
  // - compliance_violations?: string[] | null - Any compliance violations
  
  console.log(`Chunk from ${data.participantIdentity}:`, data.deltaContent);
});

// ObserverCompleteData is emitted when observer message is complete
client.on('observerComplete', (data: ObserverCompleteData) => {
  // data contains:
  // - participantIdentity: string - ID of the participant
  // - fullContent: string - Final content of the message
  // - usage?: {...} | null - Usage statistics if available
  // - compliance_violations?: string[] | null - Final compliance violations
  // - observer_metadata?: any - Observer metadata with decision information
  // - rawContent?: string - Original message content before processing
  
  console.log('Observer message:', data.fullContent);
  
  // Check if this is a proactive message
  if (data.observer_metadata?.is_proactive) {
    console.log('Received proactive message from observer agent');
  }
});

// ObserverErrorData is emitted when an error occurs with the observer
client.on('observerStreamError', (data: ObserverErrorData) => {
  // data contains:
  // - participantIdentity: string - ID of the participant
  // - error: string - The error message
  
  console.error('Observer error:', data.error);
});

// ObserverSessionEndedData is emitted when observer signals end of proactive messaging
client.on('observerSessionEnded', (data: ObserverSessionEndedData) => {
  // data contains:
  // - participantIdentity: string - ID of the participant
  // - reason: 'max_messages_reached' | 'session_ended' - Reason for ending
  
  console.log(`Observer session ended. Reason: ${data.reason}`);
});
```

**d) Sending Messages via `client.chat.send()`**

When the observer is enabled and connected, `client.chat.send(messageContent)`:
1.  Constructs the payload (system message, history, user message).
2.  Sends it via the LiveKit data channel.
3.  Returns `undefined` immediately.
4.  The response arrives via observer events such as `observerComplete`.

If the observer is *not* connected, `client.chat.send()` falls back to a standard non-streaming HTTP API request and returns the `ChatCompletionResponse` directly.

**e) Observer Proactive Messaging**

The observer agent analyzes the conversation history after each AI assistant response and may send proactive messages when:
1. It detects user inactivity
2. There are unresolved questions in the conversation
3. The interaction could benefit from additional engagement

These proactive messages are delivered through the unified streaming events with special metadata:
```typescript
client.on('observerComplete', (data) => {
  // Check if this is a proactive message from the observer
  if (data.observer_metadata?.is_proactive) {
    console.log('Observer proactive message:', data.fullContent);
    // Handle the proactive message in your UI
  }
});

client.on('observerSessionEnded', (data: ObserverSessionEndedData) => {
  console.log(`Observer session ended. Reason: ${data.reason}`);
  // Update UI to inform the user that proactive messages will no longer be sent.
});
```

Proactive messages include helpful metadata in the `observer_metadata` object:
- `is_proactive`: Boolean flag indicating this is a proactive message
- `observer_analysis`: The analysis of the conversation that led to this proactive message
- `observer_message`: The message crafted specifically for this engagement scenario

The `observerSessionEnded` event provides a `reason` for why proactive messaging was stopped:
- `max_messages_reached`: The configured limit for proactive messages was hit.
- `session_ended`: The observer agent detected that the conversation naturally concluded.

---

### 7. Image Generation

The SDK provides support for generating images from text prompts. This can be triggered directly or through the chat completion response.

#### a) Direct Image Generation (`client.generateImage`)

Generate an image directly from a text prompt:

```javascript
// Generate an image from a prompt
try {
  const imageUrl = await client.generateImage("A serene mountain landscape at sunset");
  console.log('Generated image URL:', imageUrl);
} catch (error) {
  console.error('Image generation failed:', error);
}
```

The `generateImage` method:
- Makes an API request to the image generation endpoint
- Adds the image to chat history automatically
- Returns the image URL directly

#### b) Model-Suggested Image Generation via Chat

When you set `check_image_generation: true`, the model can decide if an image should be generated based on the conversation. If it does decide to generate an image, the response will include an `image_prompt` field:

```javascript
const response = await client.chat.completions({
  messages: [{ role: 'user', content: 'Create an image of a futuristic city' }],
  check_image_generation: true // Allow the model to suggest image generation
});

// Check if the model suggested an image
if (response.choices[0].message.image_prompt) {
  const imagePrompt = response.choices[0].message.image_prompt;
  console.log("Model suggested image prompt:", imagePrompt);
  
  // Generate the image using the provided prompt
  const imageUrl = await client.generateImage(imagePrompt);
  console.log("Generated image URL:", imageUrl);
}
```

This two-step approach gives you full control over:
1. When to generate images (you can check the prompt first)
2. How to handle image generation errors
3. When to display the image in your UI

#### c) Image Response Format

When an image is generated, it is added to the chat history as an assistant message with HTML content:

```html
<img src='https://image-url.example/generated-image.jpg' description='The image prompt text' />
```

This gives the AI the context of the image it generated and displayed to the user.

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
5.  Run example auth server: `cd examples/auth-server && npm install && npm start`
6.  Open `examples/test-sdk/index.html` in your browser to test the SDK.