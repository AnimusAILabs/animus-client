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
    // Set up listeners first (see API Documentation -> Streaming Events)
    client.on('streamChunk', (data) => {
        if (data.deltaContent) process.stdout.write(data.deltaContent);
    });
    client.on('streamComplete', (data) => {
        console.log('\nStream finished. Full content:', data.fullContent);
    });
    client.on('streamError', (data) => {
        console.error('\nStream error:', data.error);
    });

    // Start the stream (returns AsyncIterable, but events handle UI updates)
    await client.chat.completions({
      messages: messages,
      stream: true
    });


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
    *   `historySize` (optional, `number`, default: 0): Enables automatic chat history management (SDK feature).
*   `vision` (optional, `AnimusVisionOptions`): If provided, enables vision features and sets defaults.
    *   `model` (**required** if `vision` provided, `string`): Default model for vision requests.
    *   `temperature` (optional, `number`): Default temperature for vision *completion* requests.
*   `observer` (optional, `AnimusObserverOptions`): Configures the LiveKit Observer connection for real-time communication.
    *   `enabled` (**required** if `observer` provided, `boolean`): Set to `true` to enable the observer feature.

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
  // If Observer is connected, this returns void and response comes via stream* events.
  // If Observer is NOT connected, this returns the ChatCompletionResponse directly.
  const response = await client.chat.send(
    "Tell me about the Animus Client SDK.",
    { // Optional overrides for this specific request (used only in HTTP fallback)
      temperature: 0.8,
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
*   **Behavior:** If the LiveKit Observer is enabled and connected (see Section 5), `send()` routes the message via the observer, returns `undefined` immediately, and the response arrives via the unified `streamChunk`/`streamComplete`/`streamError` events. If the observer is not connected, `send()` falls back to a standard non-streaming HTTP request and returns the `ChatCompletionResponse`.

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
    stream: false // Explicitly non-streaming
  });
  console.log("AI Poem:", response.choices[0].message.content);
  // Check compliance violations if needed: response.compliance_violations
} catch (error) { /* ... */ }

// Streaming (Event-based):
// Set up event listeners first (see Section 5c: Unified Streaming Events)
// client.on('streamChunk', ...);
// client.on('streamComplete', ...);
// client.on('streamError', ...);

// Start the stream - this doesn't return content directly via await
// Instead, it triggers the events above.
try {
  await client.chat.completions({
    messages: messages,
    stream: true // Enable streaming
  });
  console.log("Streaming request initiated. Waiting for events...");
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

**b) Connection Management**

The SDK manages the LiveKit connection lifecycle internally when `observer.enabled` is `true`. You **must manually initiate** the connection after creating the client:

*   **Manual Connection:** `await client.connectObserverManually();`
*   **Manual Disconnection:** `await client.disconnectObserverManually();`
*   **Connection Status Events:** Listen for `observerConnecting`, `observerConnected`, `observerDisconnected`, `observerReconnecting`, `observerReconnected`, and `observerError` events on the `client` instance to track the connection state.

**c) Unified Streaming Events**

Whether a response comes via the Observer or standard HTTP streaming (`client.chat.completions({ stream: true })`), the SDK uses a **unified set of events** emitted by the `AnimusClient` instance:

*   `streamChunk`: Fired for each piece of data received. Contains `source` ('observer'|'http'), `chunk` (raw data), `deltaContent`, `compliance_violations`.
*   `streamComplete`: Fired when the stream finishes successfully. Contains `source`, `fullContent`, `usage`, `compliance_violations`.
*   `streamError`: Fired if an error occurs during the stream. Contains `source`, `error` (message).

```typescript
import { StreamChunkData, StreamCompleteData, StreamErrorData } from 'animus-client';

let currentAssistantResponse = ''; // Accumulator

client.on('streamChunk', (data: StreamChunkData) => {
  console.log(`Chunk from ${data.source}:`, data.chunk); // data.source is 'observer' or 'http'
  if (data.deltaContent) {
    currentAssistantResponse += data.deltaContent;
    // Update UI incrementally
  }
  // Note: Compliance violations are typically only sent with non-streaming responses
});

client.on('streamComplete', (data: StreamCompleteData) => {
  console.log(`Stream complete from ${data.source}:`, data);
  // Finalize UI update with data.fullContent
  // SDK handles history update internally

  currentAssistantResponse = ''; // Reset accumulator
});

client.on('streamError', (data: StreamErrorData) => {
  console.error(`Stream error from ${data.source}:`, data.error);
  // Update UI to show error
  currentAssistantResponse = ''; // Reset accumulator
});

// --- Triggering Streams ---

// 1. Via Observer (if connected) using chat.send()
//    Returns void, response comes via stream* events above.
try {
    // Ensure observer is connected first via connectObserverManually() and 'observerConnected' event
    await client.chat.send("Hello via observer!");
} catch(e) { /* handle send error */ }


// 2. Via HTTP using chat.completions()
//    Also emits stream* events above.
try {
    await client.chat.completions({
        messages: [{ role: 'user', content: 'Hello via HTTP stream!' }],
        stream: true
    });
} catch(e) { /* handle completions error */ }

```

**d) Sending Messages via `client.chat.send()`**

When the observer is enabled and connected, `client.chat.send(messageContent)`:
1.  Constructs the payload (system message, history, user message).
2.  Sends it via the LiveKit data channel.
3.  Returns `undefined` immediately.
4.  The response arrives via the unified `streamChunk`, `streamComplete`, and `streamError` events.

If the observer is *not* connected, `client.chat.send()` falls back to a standard non-streaming HTTP API request and returns the `ChatCompletionResponse` directly (no stream events are emitted in this fallback case).

---

### 7. Error Handling

The SDK throws specific error types:

*   `AuthenticationError`: Issues related to fetching or validating the access token (e.g., invalid `tokenProviderUrl`, token expiry).
*   `ApiError`: Errors returned directly from the Animus API (e.g., invalid request parameters, model errors). Includes `status` code and `errorData`.
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