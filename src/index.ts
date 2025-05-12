// Main SDK Client
export { AnimusClient } from './AnimusClient';

// Configuration and Error Types
export type {
  AnimusClientOptions,
  AnimusClientEventMap,
  // Observer-specific event data interfaces
  ObserverChunkData,
  ObserverCompleteData,
  ObserverErrorData,
  ObserverSessionEndedData,
  // Stream Source type
  StreamSource
} from './AnimusClient';
export { AuthenticationError, ApiError } from './AnimusClient'; // Re-exported from AnimusClient

// Chat Module Types
export type {
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  Tool,
  ToolCall
} from './Chat';

// Media Module Types
export type {
  MediaMessage,
  MediaCompletionRequest,
  MediaCompletionResponse,
  MediaAnalysisRequest,
  MediaAnalysisResultResponse,
  MediaAnalysisStatusResponse
} from './Media';

// Re-export ConnectionState from livekit-client for easier consumption
export { ConnectionState } from 'livekit-client';

// --- Usage Example (for documentation/testing later) ---
/*
import { AnimusClient, ChatMessage } from './index'; // Or from the built package

async function example() {
  try {
    const client = new AnimusClient({
      tokenProviderUrl: '/api/get-animus-token', // Example URL for the user's token proxy
      apiBaseUrl: 'https://api.animusai.co/v3', // Optional, defaults to v3
      tokenStorage: 'sessionStorage' // Optional, default
    });

    // Example: Chat Completion
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Write a haiku about browsers.' }
    ];

    const chatResponse = await client.chat.completions({
      model: 'vivian-llama3.1-70b-1.0-fp8', // Or use default if configured
      messages: messages,
      temperature: 0.7
    });
    console.log('Chat Response:', chatResponse.choices[0].message.content);

    // Example: Streaming Chat Completion
    const stream = await client.chat.completions({
      model: 'vivian-llama3.1-70b-1.0-fp8',
      messages: messages,
      stream: true
    });

    console.log('Streaming Chat Response:');
    for await (const chunk of stream) {
      process.stdout.write(chunk.choices[0]?.delta?.content || '');
    }
    console.log('\nStream finished.');


    // Example: Media Analysis (Image)
    const imageAnalysis = await client.media.analyze({
        media_url: 'https://example.com/image.jpg',
        metadata: ['categories', 'tags']
    });
    console.log('Image Analysis:', imageAnalysis.metadata);


    // Example: Media Analysis (Video - starts polling)
    const videoAnalysis = await client.media.analyze({
        media_url: 'https://example.com/video.mp4',
        metadata: ['categories', 'actions']
    });
    console.log('Video Analysis Results:', videoAnalysis.results);


  } catch (error) {
    console.error('Animus SDK Error:', error);
  }
}

// example();
*/