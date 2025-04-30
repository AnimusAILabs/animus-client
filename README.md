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
    const stream = await client.chat.completions({
      messages: messages,
      stream: true
    });

    console.log('Streaming Chat Response:');
    let fullResponse = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      fullResponse += content;
      process.stdout.write(content); // Or update UI incrementally
    }
    console.log('\nStream finished.');
    // fullResponse contains the complete streamed message

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
    compliance: true,       // Default: false (Enables content moderation)

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
  // historySize: 10 // Default is 0 (disabled), requires chat config
});
```

**Configuration (`AnimusClientOptions`):**

*   `tokenProviderUrl` (**required**, `string`): The URL of your secure backend endpoint that provides Animus access tokens.
*   `apiBaseUrl` (optional, `string`): Overrides the default Animus API endpoint (`https://api.animusai.co/v3`).
*   `tokenStorage` (optional, `'sessionStorage' | 'localStorage'`): Choose where to store the auth token (default: `'sessionStorage'`).
*   `historySize` (optional, `number`): Enables automatic chat history management if set > 0. Requires `chat` configuration to be present. Default is `0` (disabled).
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
  const response = await client.chat.send(
    "Tell me about the Animus Client SDK.",
    { // Optional overrides for this specific request
      temperature: 0.8,
      // model: 'specific-model-override' // Can override model here too
    }
  );
  console.log("AI:", response.choices[0].message.content);

} catch (error) {
  // Handle errors (see Error Handling section)
  if (error instanceof ApiError) console.error("API Error:", error.message);
  else console.error("Error:", error);
}
```
*   **Note:** If the LiveKit Observer is enabled and connected (see Section 5), `send()` will route the message through the observer. In this case, the `send()` method will return `undefined` immediately, and the response chunks/completion will arrive via the `observerMessage` and `observerStreamComplete` events. History (including reasoning extraction) is updated automatically when the stream completes. If the observer is not connected, `send()` falls back to standard HTTP request/response and does *not* support streaming via this method.

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
    max_tokens: 100 // Optional override
  });
  console.log("AI Poem:", response.choices[0].message.content);
} catch (error) { /* ... */ }

// Streaming (Event-based):
// Set up event listeners first
client.on('streamChunk', (data) => {
  // Process each chunk
  if (data.deltaContent) {
    process.stdout.write(data.deltaContent);
  }
  
  // Compliance violations are not sent in streaming chunks
});

client.on('streamComplete', (data) => {
  console.log("\nStream complete!");
  console.log("Final content:", data.fullContent);
  // Compliance violations are not sent in streaming chunks
});

client.on('streamError', (data) => {
  console.error("Stream error:", data.error);
});

// Start the stream - this doesn't return content directly
// Instead, it triggers the events above
try {
  await client.chat.completions({
    messages: messages,
    stream: true // Enable streaming
  });
} catch (error) { /* ... */ }
```

*   **Key Types:** `ChatMessage` (see above), `ChatCompletionRequest`, `ChatCompletionResponse`, `ChatCompletionChunk`.
*   **History & Reasoning:** When `historySize` > 0, the SDK automatically includes previous messages (excluding the `reasoning` field) in the request. When processing responses (streaming or non-streaming), `<think>` tags are extracted into the `reasoning` field before the message is added to history.

**c) Chat History Management**

The SDK provides methods to manipulate the conversation history directly, allowing UIs to stay in sync with the SDK's internal state:

```typescript
// Get copy of current chat history
const history = client.chat.getChatHistory();
console.log(`Current chat has ${history.length} messages`);

// Replace entire history (e.g. when loading a saved conversation)
// Second parameter (validate) is optional, defaults to true
const importCount = client.chat.setChatHistory(savedConversation, true);
console.log(`Imported ${importCount} messages`);

// Update a specific message
const updateSuccess = client.chat.updateHistoryMessage(2, {
  content: "Updated content",
  name: "CustomName"
});

// Delete a specific message
const deleteSuccess = client.chat.deleteHistoryMessage(3);

// Clear all history
const clearedCount = client.chat.clearChatHistory();
console.log(`Cleared ${clearedCount} messages`);
```

These methods enable several powerful UI features:
- Loading saved conversations from external storage
- Editing message content displayed in the UI while keeping the SDK in sync
- Removing specific messages from the conversation
- "Forgetting" the entire conversation history

When updating assistant messages that contain `<think>...</think>` tags, the SDK automatically processes them to extract reasoning, just like it does for new messages.

---

### 3. Content Compliance (Chat Moderation)

The Animus API integrates content moderation directly into the chat completions endpoint via the `compliance` parameter.

*   **Enabling:** Set `compliance: true` in the `AnimusChatOptions` during client initialization (this is the default) or within a specific `client.chat.completions` or `client.chat.send` request.
*   **Disabling:** Set `compliance: false` to bypass moderation checks.
*   **Response:** When enabled and violations are detected, the response will include a `compliance_violations` field, which is an array of strings indicating the detected categories (e.g., `["drug_use", "gore"]`).

**Note:** Content moderation (`compliance: true`) is currently **only supported for non-streaming requests** (`stream: false`). Streaming requests will ignore the `compliance` flag, and no `compliance_violations` will be returned via stream events.

#### Non-streaming Compliance Detection

For non-streaming responses (`stream: false`), check the `compliance_violations` field in the response object:

```typescript
const response = await client.chat.send("Some potentially non-compliant text."); // send() is always non-streaming

// Or using completions:
// const response = await client.chat.completions({
//   messages: [{ role: 'user', content: 'Some potentially non-compliant text.' }],
//   stream: false, // Ensure stream is false
//   compliance: true // Ensure compliance is true
// });


if (response.compliance_violations && response.compliance_violations.length > 0) {
  console.warn("Content violations detected:", response.compliance_violations);
  // Handle the violation (e.g., notify user, discard response)
} else {
  // No violations detected, proceed with the response content
  console.log("AI:", response.choices[0].message.content);
}
```

#### Automatic History Management

The SDK automatically handles compliance violations for chat history:

* Responses with compliance violations are not added to the internal conversation history
* This prevents problematic content from being included in the context window for future requests
* No additional code is required for this behavior

*   **Violation Categories:** The system can detect categories such as `pedophilia`, `beastiality`, `murder`, `rape`, `incest`, `gore`, `prostitution`, and `drug_use`.
*   **Best Practices:**
    *   Keep `compliance: true` (the default) for user-generated content.
    *   Implement user-friendly handling for flagged content.
    *   Consider basic client-side filtering for obvious violations.
    *   Review flagged content periodically to understand patterns.

---

### 4. Media / Vision (`client.media`)

Interact with vision models. Accessed via `client.media`. Requires `vision` options (with `model`) to be configured during client initialization to use configured defaults.

**a) Media Completions (`client.media.completions`)**

Ask questions about images. Uses the configured `vision.model` unless overridden in the request.

```typescript
import { MediaMessage } from 'animus-client';

// Assumes client was initialized with vision options (model)
const visionMessages: MediaMessage[] = [
  { role: 'user', content: [
    { type: 'text', text: 'Describe this image.' },
    { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
    // Can also use base64 data URI: url: 'data:image/jpeg;base64,...'
  ]}
];

try {
  const response = await client.media.completions({
    messages: visionMessages,
    model: 'override-vision-model-if-needed' // Optional: overrides configured default
  });
  console.log("Vision Response:", response.choices[0].message.content);
} catch (error) { /* ... */ }
```

*   **Key Types:** `MediaMessage`, `MediaCompletionRequest`, `MediaCompletionResponse`.

**b) Media Analysis (`client.media.analyze`)**

Extract metadata from images or videos. Uses the configured `vision.model` unless overridden in the request.

```typescript
// Image Analysis
try {
  const imageAnalysis = await client.media.analyze({
    media_url: 'https://example.com/image.jpg',
    metadata: ['categories', 'tags'], // Specify desired metadata types
    // model: 'override-analysis-model' // Optional: overrides configured default
  });
  console.log('Image Categories:', imageAnalysis.metadata?.categories);
} catch (error) { /* ... */ }

// Video Analysis (starts polling)
try {
  console.log("Starting video analysis...");
  const videoAnalysis = await client.media.analyze({
    media_url: 'https://example.com/video.mp4',
    metadata: ['actions', 'scene']
    // model: 'override-analysis-model' // Optional: overrides configured default
  });
  console.log('Video Actions:', videoAnalysis.results?.[0]?.actions);
} catch (error) { /* ... */ }
```

*   **Key Types:** `MediaAnalysisRequest`, `MediaAnalysisResultResponse`.

**c) Get Analysis Status (`client.media.getAnalysisStatus`)**

Manually check the status of a video analysis job.

```typescript
try {
  const jobId = 'some_job_id_from_analyze';
  const status = await client.media.getAnalysisStatus(jobId);
  console.log(`Job ${jobId} Status: ${status.status}, Progress: ${status.percent_complete}%`);
} catch (error) { /* ... */ }
```

*   **Key Type:** `MediaAnalysisStatusResponse`.

---

### 5. Authentication (`client.clearAuthToken`)

Manually clear the stored authentication token.

```typescript
client.clearAuthToken();
```

---

### 5. LiveKit Observer (Real-time Communication)

The SDK includes optional support for real-time, low-latency communication with compatible Animus agents using LiveKit. This is primarily used for streaming responses back to the client efficiently.

**a) Enabling the Observer**

To enable the observer, provide the `observer` configuration object with `enabled: true` during client initialization:

```typescript
const client = new AnimusClient({
  tokenProviderUrl: '...',
  chat: { /* ... */ },
  observer: {
    enabled: true
  }
});
```

**b) Manual Connection & Disconnection**

Unlike other features, the observer connection **must be initiated manually** after the client is created.

```typescript
async function connectAndSetupObserver() {
  if (!client.options.observer?.enabled) return; // Check if enabled

  try {
    console.log("Connecting observer...");
    await client.connectObserverManually();
    console.log("Observer connection initiated successfully.");
    // Setup event listeners now or after the 'observerConnected' event fires
  } catch (error) {
    console.error("Failed to connect observer:", error);
  }
}

async function disconnectObserver() {
   if (!client.options.observer?.enabled) return;

   try {
     console.log("Disconnecting observer...");
     await client.disconnectObserverManually();
     console.log("Observer disconnected.");
   } catch (error) {
     console.error("Failed to disconnect observer:", error);
   }
}

// Example usage:
// connectAndSetupObserver();
// Later...
// disconnectObserver();
```

**c) Streaming Events**

The `AnimusClient` instance is an `EventEmitter` that emits events for both Observer connections and streaming data.

*Unified Streaming Events (for both HTTP API and Observer):*

*   `streamChunk`: Fired for each content chunk received from either the HTTP API or Observer stream. Contains:
    * `source`: Either `'observer'` or `'http'` to identify the source
    * `chunk`: The raw chunk object
    * `deltaContent`: The content delta from this chunk (if any)
    * `compliance_violations`: Any compliance violations detected in the stream
    
*   `streamComplete`: Fired when a stream successfully completes. Contains:
    * `source`: Either `'observer'` or `'http'` to identify the source
    * `fullContent`: The complete aggregated content
    * `usage`: Final usage statistics if available
    * `compliance_violations`: Final compliance violations status
    
*   `streamError`: Fired when a stream encounters an error. Contains:
    * `source`: Either `'observer'` or `'http'` to identify the source
    * `error`: The error message

*Observer Connection Events:*

*   `observerConnecting`: Fired when the Observer connection attempt begins.
*   `observerConnected`: Fired when the Observer connection is successfully established.
*   `observerDisconnected`: Fired when the Observer connection is lost or closed.
*   `observerReconnecting`: Fired when attempting to automatically reconnect.
*   `observerReconnected`: Fired when successfully reconnected.
*   `observerError`: Fired when a connection-related error occurs.

**Note:** Streaming (both HTTP and Observer) now uses the same event-based interface. Set up listeners for the unified events and call `client.chat.completions({ stream: true, ... })` to start the stream.

**d) Handling Streaming Responses (UI Example)**

Here's a basic example of how a UI might accumulate streamed chat responses using the unified streaming events. Note that history management (including reasoning extraction and compliance checks) happens automatically within the SDK.

```typescript
let currentAssistantMessageElement = null; // Reference to the UI element being updated
let hasComplianceViolations = false; // Track if the current stream has violations

// Set up event listeners for the unified streaming events
client.on('streamChunk', (data) => {
  console.log('Received stream chunk:', data);

  // Check for compliance violations
  if (data.compliance_violations && data.compliance_violations.length > 0) {
    hasComplianceViolations = true;
    console.warn(`Compliance violation detected: ${data.compliance_violations.join(', ')}`);
    
    // You might want to handle this by:
    if (currentAssistantMessageElement) {
      currentAssistantMessageElement.classList.add('compliance-warning');
      // Add a visual indicator
      const warningIcon = document.createElement('span');
      warningIcon.className = 'warning-icon';
      warningIcon.textContent = '⚠️ ';
      currentAssistantMessageElement.prepend(warningIcon);
    }
  }

  // Process content delta if present
  if (data.deltaContent) {
    if (!currentAssistantMessageElement) {
      // First chunk with content - create the UI element
      currentAssistantMessageElement = createNewAssistantBubble(); // Your UI function
      console.log("Starting new response display...");
    }
    
    // Continue to display content even if compliance issues were detected
    // (or you could choose not to display content with violations)
    currentAssistantMessageElement.textContent += data.deltaContent;
    // Scroll UI if needed
  }
});

client.on('streamComplete', (data) => {
  console.log(`Stream complete from ${data.source}`);
  
  // Compliance violations are not sent via streaming/observer events.
  // Finalize the UI message bubble (e.g., remove 'streaming' indicator)
  if (currentAssistantMessageElement) {
    currentAssistantMessageElement.classList.remove('streaming');
    currentAssistantMessageElement.classList.add('complete');
  }
  
  currentAssistantMessageElement = null; // Reset UI element tracker
  hasComplianceViolations = false; // Reset for next stream
  // Re-enable UI input, etc.
});

client.on('streamError', (data) => {
  console.error(`Stream error (${data.source}): ${data.error}`);
  
  // Handle error in UI
  if (currentAssistantMessageElement) {
    currentAssistantMessageElement.textContent += `\n--- ERROR: ${data.error} ---`;
    currentAssistantMessageElement.classList.add('error'); // Example style
  }
  
  // Reset state
  currentAssistantMessageElement = null;
  hasComplianceViolations = false;
  // Re-enable UI input, etc.
});

// Connection event handling for Observer
client.on('observerConnected', () => {
  console.log("Observer connected! Ready for real-time messages.");
  // Enable UI elements that depend on the observer connection
});

client.on('observerDisconnected', () => {
  console.log("Observer disconnected");
  // Disable UI elements, reset streaming state if necessary
  currentAssistantMessageElement = null;
});

// Remember to call connectObserverManually() to start the observer connection!

function createNewAssistantBubble() {
    // Your implementation to add a new message element to the chat UI
    const bubble = document.createElement('div');
    bubble.className = 'assistant-message streaming';
    document.getElementById('chat-container').appendChild(bubble);
    return bubble;
}
```

---

### 6. Error Handling

SDK methods can throw specific errors:

*   `AuthenticationError`: Problem fetching the token from your `tokenProviderUrl`.
*   `ApiError`: An error returned by the Animus API. Contains `status`, `message`, `errorData`.
*   `Error`: General configuration errors (e.g., missing required model or system message in config when using dependent methods).

```typescript
import { ApiError, AuthenticationError } from 'animus-client';

try {
  // ... SDK call ...
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error('Authentication failed:', error.message);
  } else if (error instanceof ApiError) {
    console.error(`API Error (${error.status}):`, error.message, error.errorData);
  } else if (error instanceof Error) { // Catch config errors
    console.error('Configuration or Usage Error:', error.message);
  } else {
    console.error('An unexpected error occurred:', error);
  }
}
```

## Automated Releases

This project uses [semantic-release](https://github.com/semantic-release/semantic-release) to automate the package release process. Releases are triggered automatically on pushes to the `main` branch.

- **Versioning:** Version numbers are determined automatically based on commit messages following the [Conventional Commits](https://www.conventionalcommits.org/) specification.
- **Changelog:** A `CHANGELOG.md` file is automatically generated and updated with each release.
- **Publishing:** New versions are automatically published to npm and a GitHub Release is created.

Ensure your commit messages follow the Conventional Commits format to trigger releases correctly (e.g., `feat: Add new feature`, `fix: Correct a bug`, `docs: Update documentation`). Commits like `chore: ...` or `refactor: ...` will not trigger a release unless they include breaking changes in the commit body/footer.

---

## Development

1.  Clone the repository.
2.  Install dependencies: `npm install`
3.  Build the SDK: `npm run build`
4.  Run in watch mode: `npm run dev`