# Animus Client SDK (Browser)

[![npm version](https://badge.fury.io/js/animus-client-sdk.svg)](https://badge.fury.io/js/animus-client-sdk) <!-- Placeholder badge -->

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

## Installation

```bash
npm install animus-client-sdk
# or
yarn add animus-client-sdk
```

## Prerequisites: Token Proxy Endpoint

**Important:** To maintain security, this SDK does **not** handle your `clientSecret` directly in the browser. You **must** create a secure backend endpoint (a "Token Proxy") that:

1.  Securely stores your Animus `clientId` and `clientSecret`.
2.  Receives a request from this SDK.
3.  Uses your credentials to obtain an access token from the Animus Authentication service (details TBD, likely a standard OAuth flow like client credentials).
4.  Returns the access token and its expiry time (in seconds) to the SDK in a JSON format like:
    ```json
    {
      "accessToken": "your_fetched_access_token",
      "expiresIn": 3600
    }
    ```

An example Node.js/Express implementation of such a proxy can be found in the `/examples/auth-server` directory of this repository.

## Usage

```typescript
import { AnimusClient, ChatMessage, ApiError, AuthenticationError } from 'animus-client-sdk';

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
import { AnimusClient } from 'animus-client-sdk';

const client = new AnimusClient({
  // Required:
  tokenProviderUrl: 'https://your-backend.server.com/api/get-animus-token',

  // Optional: Configure chat defaults (model & systemMessage required if chat object is present)
  chat: {
    model: 'vivian-llama3.1-8b-1.0-fp8', // Required if providing chat config
    systemMessage: 'You are Animus, a helpful AI assistant.', // Required if providing chat config
    temperature: 0.7 // Optional chat default
  },

  // Optional: Configure vision defaults (model required if vision object is present)
  vision: {
    model: 'animuslabs/Qwen2-VL-NSFW-Vision-1.2', // Required if providing vision config
    // temperature: 0.2 // Optional vision default
  },

  // Optional: Other top-level settings
  // apiBaseUrl: 'https://api.animusai.co/v3',
  // tokenStorage: 'localStorage', // 'sessionStorage' is default
  // conversationWindowSize: 10 // Default is 0 (disabled), requires chat config
});
```

**Configuration (`AnimusClientOptions`):**

*   `tokenProviderUrl` (**required**, `string`): The URL of your secure backend endpoint that provides Animus access tokens.
*   `apiBaseUrl` (optional, `string`): Overrides the default Animus API endpoint (`https://api.animusai.co/v3`).
*   `tokenStorage` (optional, `'sessionStorage' | 'localStorage'`): Choose where to store the auth token (default: `'sessionStorage'`).
*   `conversationWindowSize` (optional, `number`): Enables automatic chat history management if set > 0. Requires `chat` configuration to be present. Default is `0` (disabled).
*   `chat` (optional, `AnimusChatOptions`): If provided, enables chat features and sets defaults.
    *   `model` (**required** if `chat` provided, `string`): Default model for chat requests.
    *   `systemMessage` (**required** if `chat` provided, `string`): Default system prompt for chat.
    *   `temperature`, `top_p`, `max_tokens` (optional, `number`): Default parameters for chat requests.
*   `vision` (optional, `AnimusVisionOptions`): If provided, enables vision features and sets defaults.
    *   `model` (**required** if `vision` provided, `string`): Default model for vision requests (completions and analysis).
    *   `temperature` (optional, `number`): Default temperature for vision completion requests.

---

### 2. Chat (`client.chat`)

Interact with chat models. Accessed via `client.chat`. Requires `chat` options to be configured during client initialization.

**a) Simple Send (`client.chat.send`)**

The easiest way to have a conversation. Sends a single user message and gets a response, using configured defaults and history.

```typescript
import { ApiError, AuthenticationError } from 'animus-client-sdk';

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
*   **Note:** `send()` does not support streaming.

**b) Full Completions (`client.chat.completions`)**

Provides more control, allowing you to send multiple messages at once and optionally stream the response. Uses configured defaults unless overridden.

```typescript
import { ChatMessage } from 'animus-client-sdk';

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

// Streaming:
try {
  const stream = await client.chat.completions({
    messages: messages,
    stream: true // Enable streaming
    // Can also override model, temperature etc. here
  });

  console.log("AI Streaming Poem:");
  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
  console.log("\n(Stream complete)");
} catch (error) { /* ... */ }
```

*   **Key Types:** `ChatMessage`, `ChatCompletionRequest`, `ChatCompletionResponse`, `ChatCompletionChunk`.

---

### 3. Media / Vision (`client.media`)

Interact with vision models. Accessed via `client.media`. Requires `vision` options (with `model`) to be configured during client initialization to use configured defaults.

**a) Media Completions (`client.media.completions`)**

Ask questions about images. Uses the configured `vision.model` unless overridden in the request.

```typescript
import { MediaMessage } from 'animus-client-sdk';

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

### 4. Authentication (`client.clearAuthToken`)

Manually clear the stored authentication token.

```typescript
client.clearAuthToken();
```

---

### 5. Error Handling

SDK methods can throw specific errors:

*   `AuthenticationError`: Problem fetching the token from your `tokenProviderUrl`.
*   `ApiError`: An error returned by the Animus API. Contains `status`, `message`, `errorData`.
*   `Error`: General configuration errors (e.g., missing required model or system message in config when using dependent methods).

```typescript
import { ApiError, AuthenticationError } from 'animus-client-sdk';

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

## Development

1.  Clone the repository.
2.  Install dependencies: `npm install`
3.  Build the SDK: `npm run build`
4.  Run in watch mode: `npm run dev`