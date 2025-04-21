import { describe, it, expect, vi } from 'vitest';
import { ChatModule, ChatCompletionRequest, ChatCompletionChunk, ChatCompletionResponse } from '../src/Chat';
import { RequestUtil } from '../src/RequestUtil';
import { AuthHandler } from '../src/AuthHandler';

// Mock dependencies
vi.mock('../src/RequestUtil');
vi.mock('../src/AuthHandler');

describe('ChatModule', () => {
  let requestUtilMock: RequestUtil;
  let chatModule: ChatModule;

  beforeEach(() => {
    // Create instances of mocks for each test
    // Provide both arguments to AuthHandler constructor
    const authHandlerMock = new AuthHandler('http://dummy-url', 'sessionStorage');
    requestUtilMock = new RequestUtil('http://dummy-base', authHandlerMock);
    chatModule = new ChatModule(requestUtilMock, { model: 'test-chat-model', systemMessage: 'Test system message' });
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore mocks after each test
  });

  it('should instantiate correctly', () => {
    expect(chatModule).toBeInstanceOf(ChatModule);
  });

  it('should have a completions method', () => {
    expect(chatModule.completions).toBeInstanceOf(Function);
  });

  it('should have a send method', () => {
    expect(chatModule.send).toBeInstanceOf(Function);
  });

  it('should store initial chat options', () => {
    // Access private config for testing (use with caution or refactor for testability)
    expect((chatModule as any).config?.model).toBe('test-chat-model');
    expect((chatModule as any).config?.systemMessage).toBe('Test system message');
  });

  it('should call requestUtil with stream=true and return AsyncIterable for streaming completions', async () => {
    // Mock the raw Response for streaming, simulating OpenAI SSE format
    const mockStreamResponse = {
      ok: true,
      status: 200,
      body: new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          // Chunk 1
          const chunk1 = { id: 'chunk1', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk1)}\n\n`));
          await new Promise(r => setTimeout(r, 1)); // Small delay

          // Chunk 2
          const chunk2 = { id: 'chunk1', choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk2)}\n\n`));
          await new Promise(r => setTimeout(r, 1));

          // Chunk 3
          const chunk3 = { id: 'chunk1', choices: [{ index: 0, delta: { content: ' world!' }, finish_reason: null }] };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk3)}\n\n`));
          await new Promise(r => setTimeout(r, 1));

          // Done signal
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      }),
      headers: new Headers({ 'Content-Type': 'text/event-stream' }),
    } as Response;

    // Mock requestUtil.request specifically for this test
    const requestMock = vi.spyOn(requestUtilMock, 'request'); // Let TS infer the spy type
    requestMock.mockResolvedValue(mockStreamResponse);


    const request: ChatCompletionRequest & { stream: true } = {
      messages: [{ role: 'user', content: 'Say hello' }],
      stream: true,
    };

    // Explicitly type the result for the streaming case using safer assertion
    const result = await chatModule.completions(request) as unknown as AsyncIterable<ChatCompletionChunk>;

    // 1. Check if requestUtil was called correctly
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith(
      'POST',
      '/chat/completions',
      expect.objectContaining({
        messages: expect.arrayContaining([
          { role: 'system', content: 'Test system message' },
          { role: 'user', content: 'Say hello' }
        ]),
        stream: true,
        model: 'test-chat-model'
      }),
      true // stream flag
    );

    // 2. Check if the result is an AsyncIterable
    expect(result).toBeDefined();
    expect(typeof result[Symbol.asyncIterator]).toBe('function');

    // 3. Consume the mock stream and verify chunks
    const chunks: ChatCompletionChunk[] = []; // Type the chunks array
    let accumulatedContent = '';
    // No need to cast result here anymore as it's typed above
    for await (const chunk of result) {
      chunks.push(chunk);
      if (chunk.choices[0]?.delta?.content) {
        accumulatedContent += chunk.choices[0].delta.content;
      }
    }
    expect(chunks.length).toBe(3); // Expecting 3 data chunks before [DONE]
    // Add non-null assertions for test safety
    expect(chunks[0]!.choices[0]!.delta).toEqual({ role: 'assistant' });
    expect(chunks[1]!.choices[0]!.delta).toEqual({ content: 'Hello' });
    expect(chunks[2]!.choices[0]!.delta).toEqual({ content: ' world!' });
    expect(accumulatedContent).toBe('Hello world!'); // Verify accumulated content

    requestMock.mockRestore(); // Clean up spy
  });

  it('should manage chat history correctly', async () => {
    // Re-initialize ChatModule with historySize
    chatModule = new ChatModule(requestUtilMock, {
      model: 'test-chat-model',
      systemMessage: 'System prompt.',
      historySize: 2 // Keep last 2 user/assistant messages
    });

    const requestMock = vi.spyOn(requestUtilMock, 'request');

    // Mock non-streaming responses
    const mockResponse1: ChatCompletionResponse = { id: 'r1', object: 'chat.completion', created: 1, model: 'test-chat-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Response 1' }, finish_reason: 'stop' }] };
    const mockResponse2: ChatCompletionResponse = { id: 'r2', object: 'chat.completion', created: 2, model: 'test-chat-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Response 2' }, finish_reason: 'stop' }] };
    const mockResponse3: ChatCompletionResponse = { id: 'r3', object: 'chat.completion', created: 3, model: 'test-chat-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Response 3' }, finish_reason: 'stop' }] };

    // Call 1
    requestMock.mockResolvedValueOnce(mockResponse1);
    await chatModule.send('User message 1');
    expect(requestMock).toHaveBeenCalledWith('POST', '/chat/completions', expect.objectContaining({
      messages: [
        { role: 'system', content: 'System prompt.' },
        { role: 'user', content: 'User message 1' }
      ]
    }), false);
    // History should be: [User1, Assistant1]
    expect((chatModule as any).chatHistory).toEqual([
        { role: 'user', content: 'User message 1' },
        { role: 'assistant', content: 'Response 1' }
    ]);

    // Call 2
    requestMock.mockResolvedValueOnce(mockResponse2);
    await chatModule.send('User message 2');
    // Corrected Expected Messages: System + relevantHistory (Assistant1) + newUser (User2)
    expect(requestMock).toHaveBeenCalledWith('POST', '/chat/completions', expect.objectContaining({
      messages: [
        { role: 'system', content: 'System prompt.' },
        // { role: 'user', content: 'User message 1' }, // User1 is pushed out by historySize=2 and availableSlots=1
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'User message 2' }
      ]
    }), false);
     // History check remains correct: [User2, Assistant2]
     // Let's re-check Chat.ts logic... Ah, it adds User THEN Assistant, then trims.
     // After User2 added: [User1, Assistant1, User2]
     // After Assistant2 added: [User1, Assistant1, User2, Assistant2]
     // After trim(2): [User2, Assistant2]
    expect((chatModule as any).chatHistory).toEqual([
        { role: 'user', content: 'User message 2' },
        { role: 'assistant', content: 'Response 2' }
    ]);


    // Call 3
    requestMock.mockResolvedValueOnce(mockResponse3);
    await chatModule.send('User message 3');
     // Corrected Expected Messages: System + relevantHistory (Assistant2) + newUser (User3)
     // History before this call was [User2, Assistant2]. availableSlots = 2-1=1. historyCount=min(2,1)=1. relevantHistory=[Assistant2]
    expect(requestMock).toHaveBeenCalledWith('POST', '/chat/completions', expect.objectContaining({
      messages: [
        { role: 'system', content: 'System prompt.' },
        // { role: 'user', content: 'User message 2' }, // User2 is pushed out
        { role: 'assistant', content: 'Response 2' },
        { role: 'user', content: 'User message 3' }
      ]
    }), false);
    // History check remains correct: [User3, Assistant3]
    expect((chatModule as any).chatHistory).toEqual([
        { role: 'user', content: 'User message 3' },
        { role: 'assistant', content: 'Response 3' }
    ]);

    requestMock.mockRestore();
  });

  it('should pass optional parameters (n, temperature, etc.) to requestUtil', async () => {
    const requestMock = vi.spyOn(requestUtilMock, 'request');
    const mockResponse: ChatCompletionResponse = { id: 'r1', object: 'chat.completion', created: 1, model: 'test-chat-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Response' }, finish_reason: 'stop' }] };
    requestMock.mockResolvedValue(mockResponse);

    const request: ChatCompletionRequest = {
      messages: [{ role: 'user', content: 'Test' }],
      n: 3,
      temperature: 0.5,
      max_tokens: 50,
      stop: ['\n'],
      // Add other params as needed
    };

    await chatModule.completions(request);

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith(
      'POST',
      '/chat/completions',
      expect.objectContaining({
        messages: expect.arrayContaining([
          { role: 'system', content: 'Test system message' },
          { role: 'user', content: 'Test' }
        ]),
        model: 'test-chat-model', // from config
        n: 3,
        temperature: 0.5,
        max_tokens: 50,
        stop: ['\n']
        // Corrected: stream: false is NOT included if not in original request
      }),
      false // stream flag passed to requestUtil is correct
    );

    requestMock.mockRestore();
  });

});