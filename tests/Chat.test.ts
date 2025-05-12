import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'; // Add beforeEach, afterEach
import { ChatModule, ChatCompletionRequest, ChatCompletionChunk, ChatCompletionResponse, Tool, ToolCall, ChatMessage } from '../src/Chat'; // Added Tool, ToolCall, ChatMessage
import { RequestUtil, ApiError } from '../src/RequestUtil'; // Import ApiError
import { AuthHandler } from '../src/AuthHandler';
import type { AnimusChatOptions } from '../src/AnimusClient'; // Import type for config

// Mock dependencies
vi.mock('../src/RequestUtil');
vi.mock('../src/AuthHandler');

// Define mocks at a higher scope
let requestUtilMock: RequestUtil;
let authHandlerMock: AuthHandler; // Define authHandlerMock here
const mockIsObserverConnected = vi.fn(() => false); // Default to false
const mockSendObserverText = vi.fn(async () => { /* Default mock */ });
const mockResetUserActivity = vi.fn(() => { /* Default mock */ });


describe('ChatModule', () => {
  let chatModule: ChatModule; // Define chatModule here

  // Default config for convenience in tests
  const defaultChatOptions: AnimusChatOptions = { model: 'test-chat-model', systemMessage: 'Test system message' };

  beforeEach(() => {
    // Create instances of mocks for each test
    authHandlerMock = new AuthHandler('http://dummy-url', 'sessionStorage'); // Instantiate here
    requestUtilMock = new RequestUtil('http://dummy-base', authHandlerMock);

    // Reset mocks before each test
    vi.resetAllMocks();
    mockIsObserverConnected.mockClear();
    mockSendObserverText.mockClear();
    mockResetUserActivity.mockClear();
    mockIsObserverConnected.mockReturnValue(false); // Ensure default is false

    // Default instantiation using mocks
    chatModule = new ChatModule(
        requestUtilMock,
        defaultChatOptions,
        mockIsObserverConnected,
        mockSendObserverText,
        mockResetUserActivity
    );
  });

  // afterEach is not strictly needed if vi.resetAllMocks() is in beforeEach
  // but keep restoreAllMocks if preferred
  afterEach(() => {
     vi.restoreAllMocks();
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

  it('should handle streaming completions (HTTP) and update history correctly', async () => {
    // Re-initialize with history enabled for this test
    const historySize = 4;
    chatModule = new ChatModule(
        requestUtilMock,
        {
            model: 'test-chat-model',
            systemMessage: 'Test system message',
            historySize: historySize // Enable history
        },
        mockIsObserverConnected,
        mockSendObserverText
    );

    // Mock the raw Response for streaming
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

    // Spy on history methods BEFORE making the call
    const addMessageSpy = vi.spyOn(chatModule as any, 'addMessageToHistory');
    const addAssistantResponseSpy = vi.spyOn(chatModule as any, 'addAssistantResponseToHistory');

    // --- Make the call ---
    // Use unknown first for type assertion as suggested by TS error
    const result = await chatModule.completions(request) as unknown as AsyncIterable<ChatCompletionChunk>;

    // --- Assertions ---

    // 1. Check user message added to history BEFORE stream consumption
    expect(addMessageSpy).toHaveBeenCalledTimes(1);
    expect(addMessageSpy).toHaveBeenCalledWith({ role: 'user', content: 'Say hello', timestamp: expect.any(String) });

    // 2. Check if requestUtil was called correctly
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith(
      'POST',
      '/chat/completions',
      expect.objectContaining({
        messages: expect.arrayContaining([
          { role: 'system', content: 'Test system message' },
          { role: 'user', content: 'Say hello', timestamp: expect.any(String) } // User message from .completions() call, timestamp added by addMessageToHistory
        ]),
        stream: true,
        model: 'test-chat-model'
      }),
      true // stream flag
    );

    // 3. Check if the result is an AsyncIterable
    expect(result).toBeDefined();
    expect(typeof result[Symbol.asyncIterator]).toBe('function');

    // 4. Consume the mock stream and verify chunks
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
    expect(accumulatedContent).toBe('Hello world!');

    // 5. Verify assistant response added to history *after* stream consumption
    expect(addAssistantResponseSpy).toHaveBeenCalledTimes(1);
    // Updated to include new default arguments for isFromObserver and tool_calls
    expect(addAssistantResponseSpy).toHaveBeenCalledWith('Hello world!', undefined, false, undefined);

    // 6. Verify final history state (addMessageToHistory handles trimming internally)
    // Access history AFTER spies have been checked
    const finalHistory = (chatModule as any).chatHistory;
    expect(finalHistory).toEqual([
        { role: 'user', content: 'Say hello', timestamp: expect.any(String) },
        { role: 'assistant', content: 'Hello world!', timestamp: expect.any(String) }
    ]);

    // Restore all spies used in this test
    requestMock.mockRestore();
    addMessageSpy.mockRestore();
    addAssistantResponseSpy.mockRestore();
  });

  it('should manage chat history correctly', async () => {
    // Re-initialize ChatModule with historySize
    chatModule = new ChatModule(
        requestUtilMock,
        {
          model: 'test-chat-model',
          systemMessage: 'System prompt.',
          historySize: 2 // Keep last 2 user/assistant messages
        },
        mockIsObserverConnected,
        mockSendObserverText
    );

    const requestMock = vi.spyOn(requestUtilMock, 'request');

    // Mock non-streaming responses
    const mockResponse1: ChatCompletionResponse = { id: 'r1', object: 'chat.completion', created: 1, model: 'test-chat-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Response 1' }, finish_reason: 'stop' }] };
    const mockResponse2: ChatCompletionResponse = { id: 'r2', object: 'chat.completion', created: 2, model: 'test-chat-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Response 2' }, finish_reason: 'stop' }] };
    const mockResponse3: ChatCompletionResponse = { id: 'r3', object: 'chat.completion', created: 3, model: 'test-chat-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Response 3' }, finish_reason: 'stop' }] };

    // Call 1
    requestMock.mockResolvedValueOnce(mockResponse1);
    await chatModule.send('User message 1');
    expect(requestMock).toHaveBeenCalledWith('POST', '/chat/completions', {
      model: 'test-chat-model',
      messages: [
        { role: 'system', content: 'System prompt.' },
        { role: 'user', content: 'User message 1', timestamp: expect.any(String) } // User message from send() has a timestamp
      ],
      stream: false,
      compliance: true
    }, false);
    // History should be: [User1, Assistant1]
    expect((chatModule as any).chatHistory).toEqual([
        { role: 'user', content: 'User message 1', timestamp: expect.any(String) },
        { role: 'assistant', content: 'Response 1', timestamp: expect.any(String) }
    ]);

    // Call 2
    requestMock.mockResolvedValueOnce(mockResponse2);
    await chatModule.send('User message 2');
    // Expected Payload: System + History BEFORE User2 (User1, Assistant1) + User2
    // History before call: [User1, Assistant1]. historySize=2. Max past history = 2-1=1. Actual past = min(2,1)=1. History to add = [Assistant1].
    expect(requestMock).toHaveBeenCalledWith('POST', '/chat/completions', {
      model: 'test-chat-model',
      messages: [
        { role: 'system', content: 'System prompt.' },
        { role: 'assistant', content: 'Response 1' }, // Correct: Historical assistant messages DON'T have timestamps in the sent payload
        { role: 'user', content: 'User message 2', timestamp: expect.any(String) } // User message from send() has a timestamp
      ],
      stream: false,
      compliance: true
    }, false);
     // Final History State Check: [User2, Assistant2] (This part remains correct)
     // Let's re-check Chat.ts logic... Ah, it adds User THEN Assistant, then trims.
     // After User2 added: [User1, Assistant1, User2]
     // After Assistant2 added: [User1, Assistant1, User2, Assistant2]
     // After trim(2): [User2, Assistant2]
    expect((chatModule as any).chatHistory).toEqual([
        { role: 'user', content: 'User message 2', timestamp: expect.any(String) },
        { role: 'assistant', content: 'Response 2', timestamp: expect.any(String) }
    ]);


    // Call 3
    requestMock.mockResolvedValueOnce(mockResponse3);
    await chatModule.send('User message 3');
     // Expected Payload: System + History BEFORE User3 (User2, Assistant2) + User3
     // History before call: [User2, Assistant2]. historySize=2. Max past history = 2-1=1. Actual past = min(2,1)=1. History to add = [Assistant2].
    expect(requestMock).toHaveBeenCalledWith('POST', '/chat/completions', {
      model: 'test-chat-model',
      messages: [
        { role: 'system', content: 'System prompt.' },
        { role: 'assistant', content: 'Response 2' }, // Correct: Historical assistant messages DON'T have timestamps
        { role: 'user', content: 'User message 3', timestamp: expect.any(String) } // User message from send() has a timestamp
      ],
      stream: false,
      compliance: true
    }, false);
    // Final History State Check: [User3, Assistant3] (This part remains correct)
    expect((chatModule as any).chatHistory).toEqual([
        { role: 'user', content: 'User message 3', timestamp: expect.any(String) },
        { role: 'assistant', content: 'Response 3', timestamp: expect.any(String) }
    ]);

    requestMock.mockRestore();
  });

  it('should pass optional parameters (n, temperature, etc.) to requestUtil', async () => {
    const requestMock = vi.spyOn(requestUtilMock, 'request');
    const mockResponse: ChatCompletionResponse = { id: 'r1', object: 'chat.completion', created: 1, model: 'test-chat-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Response' }, finish_reason: 'stop' }] };
    requestMock.mockResolvedValue(mockResponse);

    const request: ChatCompletionRequest = {
      messages: [{ role: 'user', content: 'Test' }], // No timestamp here as it's direct to .completions
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
      { // Not using expect.objectContaining for more precise matching
        messages: [ 
          { role: 'system', content: 'Test system message' },
          { role: 'user', content: 'Test' } // User message in .completions doesn't get auto-timestamped by ChatModule before this point
        ],
        model: 'test-chat-model', // from config
        n: 3,
        temperature: 0.5,
        max_tokens: 50,
        stop: ['\n'],
        stream: false, // Default from ChatModule.completions
        compliance: true // Default from ChatModule.completions
      },
      false // stream flag passed to requestUtil is correct
    );

    requestMock.mockRestore();
  });

  // --- New Tests for Default Parameters & Compliance ---

  describe('Default Parameter Handling & Compliance', () => {
    it('should apply configured defaults when calling completions', async () => {
      const defaultOptions = {
        model: 'default-model',
        systemMessage: 'Default system',
        temperature: 0.6,
        max_tokens: 150,
        stream: false, // Default stream is false
        compliance: false, // Override default compliance (which is true)
        historySize: 5,
        top_p: 0.8,
      };
      chatModule = new ChatModule(requestUtilMock, defaultOptions, mockIsObserverConnected, mockSendObserverText);
      const requestMock = vi.spyOn(requestUtilMock, 'request');
      const mockResponse: ChatCompletionResponse = { id: 'r1', object: 'chat.completion', created: 1, model: 'default-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Default response' }, finish_reason: 'stop' }] };
      requestMock.mockResolvedValue(mockResponse);

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Minimal request' }], // No timestamp here
      };

      await chatModule.completions(request);

      expect(requestMock).toHaveBeenCalledWith(
        'POST',
        '/chat/completions',
        {
          model: 'default-model',
          messages: [
            { role: 'system', content: 'Default system' },
            { role: 'user', content: 'Minimal request', timestamp: expect.any(String) } // Expect timestamp due to later mutation seen by spy
          ],
          temperature: 0.6,
          max_tokens: 150,
          stream: false,
          compliance: false,
          top_p: 0.8,
        },
        false // stream flag to requestUtil
      );
      requestMock.mockRestore();
    });

    it('should apply configured defaults when calling send', async () => {
        const defaultOptions = {
          model: 'default-model-send',
          systemMessage: 'Default system send',
          temperature: 0.4,
          max_tokens: 99,
          // compliance defaults to true
          historySize: 3,
        };
        chatModule = new ChatModule(requestUtilMock, defaultOptions, mockIsObserverConnected, mockSendObserverText);
        const requestMock = vi.spyOn(requestUtilMock, 'request');
        const mockResponse: ChatCompletionResponse = { id: 'r1', object: 'chat.completion', created: 1, model: 'default-model-send', choices: [{ index: 0, message: { role: 'assistant', content: 'Default send response' }, finish_reason: 'stop' }] };
        requestMock.mockResolvedValue(mockResponse);

        await chatModule.send('Minimal send request');

        expect(requestMock).toHaveBeenCalledWith(
          'POST',
          '/chat/completions',
          expect.objectContaining({ // Using objectContaining because timestamp is dynamic
            model: 'default-model-send',
            messages: [
                { role: 'system', content: 'Default system send'},
                { role: 'user', content: 'Minimal send request', timestamp: expect.any(String)}
            ],
            temperature: 0.4,
            max_tokens: 99,
            compliance: true, // Check default is applied
            stream: false, // Default stream is false in this test's config
          }),
          false // Default stream is false
        );
        expect(mockSendObserverText).not.toHaveBeenCalled(); // Verify observer not called
        requestMock.mockRestore();
      });

      it('should default compliance to true and return violations from response', async () => {
        // Instantiate without compliance in config
        chatModule = new ChatModule(requestUtilMock, { model: 'test-model', systemMessage: 'Test system' }, mockIsObserverConnected, mockSendObserverText);
        const requestMock = vi.spyOn(requestUtilMock, 'request');
        // Mock response *with* violations
        const mockResponse: ChatCompletionResponse = {
            id: 'r-comp-1',
            object: 'chat.completion',
            created: 1,
            model: 'test-model',
            choices: [{ index: 0, message: { role: 'assistant', content: 'Violating content' }, finish_reason: 'stop' }],
            compliance_violations: ["drug_use", "gore"] // Add violations
        };
        requestMock.mockResolvedValue(mockResponse);

        const request: ChatCompletionRequest = {
          messages: [{ role: 'user', content: 'Check compliance default' }], // No timestamp
          // No compliance specified here either
        };

        // Call completions
        const response = await chatModule.completions(request);

        // 1. Check compliance: true was sent
        expect(requestMock).toHaveBeenCalledWith(
          'POST',
          '/chat/completions',
          expect.objectContaining({
            messages: [ // Expect messages without timestamp if direct to .completions
                { role: 'system', content: 'Test system'},
                { role: 'user', content: 'Check compliance default'}
            ],
            compliance: true, // Should default to true
          }),
          false
        );

        // 2. Check the returned response includes the violations
        expect(response.compliance_violations).toBeDefined();
        expect(response.compliance_violations).toEqual(["drug_use", "gore"]);

        requestMock.mockRestore();
      });

      it('should send compliance: false when explicitly set in request', async () => {
        chatModule = new ChatModule(requestUtilMock, { model: 'test-model', systemMessage: 'Test system', compliance: true }, mockIsObserverConnected, mockSendObserverText); // Config defaults to true
        const requestMock = vi.spyOn(requestUtilMock, 'request');
        // Mock response *without* violations (as compliance is off)
        const mockResponse: ChatCompletionResponse = {
            id: 'r-comp-2',
            object: 'chat.completion',
            created: 1,
            model: 'test-model',
            choices: [{ index: 0, message: { role: 'assistant', content: 'Non-compliant but unchecked' }, finish_reason: 'stop' }],
            // No compliance_violations field expected
        };
        requestMock.mockResolvedValue(mockResponse);

        const request: ChatCompletionRequest = {
          messages: [{ role: 'user', content: 'Turn off compliance' }], // No timestamp
          compliance: false // Explicitly disable compliance for this request
        };

        const response = await chatModule.completions(request);

        // 1. Check compliance: false was sent
        expect(requestMock).toHaveBeenCalledWith(
          'POST',
          '/chat/completions',
          expect.objectContaining({
            messages: [
                { role: 'system', content: 'Test system'},
                { role: 'user', content: 'Turn off compliance'}
            ],
            compliance: false, // Should be false as requested
          }),
          false
        );

        // 2. Check the returned response does NOT include violations
        expect(response.compliance_violations).toBeUndefined();

        requestMock.mockRestore();
      });

      it('should send compliance: false when explicitly set in send options', async () => {
        chatModule = new ChatModule(requestUtilMock, { model: 'test-model', systemMessage: 'Test system', compliance: true }, mockIsObserverConnected, mockSendObserverText); // Config defaults to true
        const requestMock = vi.spyOn(requestUtilMock, 'request');
        const mockResponse: ChatCompletionResponse = { id: 'r-comp-3', object: 'chat.completion', created: 1, model: 'test-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Send non-compliant' }, finish_reason: 'stop' }] };
        requestMock.mockResolvedValue(mockResponse);

        const response = await chatModule.send('Send with compliance off', { compliance: false }); // Disable via options

        // 1. Check compliance: false was sent
        expect(requestMock).toHaveBeenCalledWith(
          'POST',
          '/chat/completions',
          expect.objectContaining({
            messages: [
                { role: 'system', content: 'Test system'},
                { role: 'user', content: 'Send with compliance off', timestamp: expect.any(String)}
            ],
            compliance: false, // Should be false as requested in options
            stream: false, // Default stream is false
          }),
          false // Default stream is false
        );

        // 2. Check the returned response does NOT include violations
        // Check response type before accessing property
        if (response && 'compliance_violations' in response) {
             expect(response.compliance_violations).toBeUndefined();
        } else {
             // This case shouldn't happen if observer mock is false, but good practice
             expect(response).toBeDefined(); // Ensure it's not void if HTTP path taken
        }

        requestMock.mockRestore();
        expect(mockSendObserverText).not.toHaveBeenCalled(); // Verify observer not called
      });

    it('should override configured defaults with completions request parameters', async () => {
      const defaultOptions = {
        model: 'default-model',
        systemMessage: 'Default system',
        temperature: 0.6,
        max_tokens: 150,
        compliance: true,
        top_p: 0.8,
      };
      chatModule = new ChatModule(requestUtilMock, defaultOptions, mockIsObserverConnected, mockSendObserverText);
      const requestMock = vi.spyOn(requestUtilMock, 'request');
      const mockResponse: ChatCompletionResponse = { id: 'r-override-1', object: 'chat.completion', created: 1, model: 'override-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Override response' }, finish_reason: 'stop' }] };
      requestMock.mockResolvedValue(mockResponse);

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Override request' }], // No timestamp
        model: 'override-model', // Override
        temperature: 0.9,       // Override
        max_tokens: 50,         // Override
        compliance: false,      // Override
        // top_p is NOT overridden, should use default
        n: 2                    // New param, not in defaults
      };

      await chatModule.completions(request);

      expect(requestMock).toHaveBeenCalledWith(
        'POST',
        '/chat/completions',
        expect.objectContaining({ // Using objectContaining because some defaults are applied
          model: 'override-model', // Check override
          messages: [
            { role: 'system', content: 'Default system'},
            { role: 'user', content: 'Override request'} // No timestamp
          ],
          temperature: 0.9,       // Check override
          max_tokens: 50,         // Check override
          compliance: false,      // Check override
          top_p: 0.8,             // Check default is used
          n: 2,                   // Check new param is included
          stream: false,          // Check default stream=false is applied
        }),
        false
      );
      requestMock.mockRestore();
    });

it('should clean think tags and store reasoning when adding assistant message to history', () => {
      // Initialize with history enabled
      chatModule = new ChatModule(
          requestUtilMock,
          { model: 'test-model', systemMessage: 'Test', historySize: 5 },
          mockIsObserverConnected,
          mockSendObserverText
      );

      const rawAssistantContent = '<think>This is reasoning.</think> This is the visible content.';
      const expectedCleanedContent = 'This is the visible content.';
      const expectedReasoning = 'This is reasoning.';

      // Call the public method that uses addMessageToHistory internally
      chatModule.addAssistantResponseToHistory(rawAssistantContent);

      // Verify the history state
      const history = (chatModule as any).chatHistory;
      expect(history.length).toBe(1);
      expect(history[0]).toEqual({
          role: 'assistant',
          content: expectedCleanedContent,
          reasoning: expectedReasoning,
          timestamp: expect.any(String)
      });
    });

    it('should handle assistant message with only think tags', () => {
        chatModule = new ChatModule(
            requestUtilMock,
            { model: 'test-model', systemMessage: 'Test', historySize: 5 },
            mockIsObserverConnected,
            mockSendObserverText
        );
        const rawAssistantContent = '<think>Only reasoning here.</think>';
        chatModule.addAssistantResponseToHistory(rawAssistantContent);
        const history = (chatModule as any).chatHistory;
        expect(history.length).toBe(1);
        expect(history[0]).toEqual({
            role: 'assistant',
            content: null, // Content should be null if empty after processing
            reasoning: 'Only reasoning here.',
            timestamp: expect.any(String)
        });
    });

    it('should handle assistant message with no think tags', () => {
        chatModule = new ChatModule(
            requestUtilMock,
            { model: 'test-model', systemMessage: 'Test', historySize: 5 },
            mockIsObserverConnected,
            mockSendObserverText
        );
        const rawAssistantContent = 'Just normal content.';
        chatModule.addAssistantResponseToHistory(rawAssistantContent);
        const history = (chatModule as any).chatHistory;
        expect(history.length).toBe(1);
        expect(history[0]).toEqual({
            role: 'assistant',
            content: 'Just normal content.',
            reasoning: undefined, // No reasoning field expected
            timestamp: expect.any(String)
        });
    });

    it('should not add empty assistant message without reasoning to history', () => {
        chatModule = new ChatModule(
            requestUtilMock,
            { model: 'test-model', systemMessage: 'Test', historySize: 5 },
            mockIsObserverConnected,
            mockSendObserverText
        );
        const rawAssistantContent = '   '; // Whitespace only
        chatModule.addAssistantResponseToHistory(rawAssistantContent);
        const history = (chatModule as any).chatHistory;
        expect(history.length).toBe(0); // History should remain empty
    });
    it('should override configured defaults with send options', async () => {
        const defaultOptions = {
          model: 'default-model-send',
          systemMessage: 'Default system send',
          temperature: 0.4,
          max_tokens: 99,
          compliance: true,
        };
        chatModule = new ChatModule(requestUtilMock, defaultOptions, mockIsObserverConnected, mockSendObserverText);
        const requestMock = vi.spyOn(requestUtilMock, 'request');
        const mockResponse: ChatCompletionResponse = { id: 'r-override-2', object: 'chat.completion', created: 1, model: 'override-model-send', choices: [{ index: 0, message: { role: 'assistant', content: 'Override send response' }, finish_reason: 'stop' }] };
        requestMock.mockResolvedValue(mockResponse);

        await chatModule.send('Override send request', {
            model: 'override-model-send', // Override
            temperature: 0.1,           // Override
            max_tokens: 200,            // Override
            compliance: false,          // Override
            top_p: 0.7,                 // New param, not in defaults
            stream: false               // Explicitly set stream in options for clarity
        });

        // Check HTTP call (Moved assertion here)
        expect(requestMock).toHaveBeenCalledWith(
          'POST',
          '/chat/completions',
          expect.objectContaining({ // Using objectContaining because timestamp is dynamic
            model: 'override-model-send',
            messages: [
                { role: 'system', content: 'Default system send'},
                { role: 'user', content: 'Override send request', timestamp: expect.any(String)}
            ],
            temperature: 0.1,
            max_tokens: 200,
            compliance: false,
            top_p: 0.7,
            stream: false // Check stream option passed correctly
          }),
          false // stream flag to requestUtil
        );
        expect(requestMock).toHaveBeenCalledTimes(1); // Verify HTTP call happened
        expect(mockSendObserverText).not.toHaveBeenCalled(); // Verify observer not called
        requestMock.mockRestore(); // Restore the mock *after* asserting calls

        // --- Add tests specifically for the Observer path ---
        // --- Add tests specifically for the Observer path ---
        describe('ChatModule - Observer Integration', () => {
            // No need for a separate beforeEach here if the main one resets mocks correctly
            // We just need to set the observer mock state for these specific tests

            it('should call sendObserverText with correct history payload based on configured historySize', async () => {
                // Arrange: Set up history and observer mock
                mockIsObserverConnected.mockReturnValue(true);
                const testHistorySize = 2; // Define history size for this test case
                chatModule = new ChatModule( // Re-init with specific historySize
                    requestUtilMock,
                    { ...defaultChatOptions, historySize: testHistorySize }, // Use the variable
                    mockIsObserverConnected,
                    mockSendObserverText
                );
                // Pre-populate history with more messages than testHistorySize to test slicing
                const fullHistory = [
                    { role: 'user', content: 'User message 1', timestamp: 'ts1' },
                    { role: 'assistant', content: 'Assistant message 1', timestamp: 'ts2' },
                    { role: 'user', content: 'User message 2', timestamp: 'ts3' },
                    { role: 'assistant', content: 'Assistant message 2', timestamp: 'ts4' } // 4 messages total
                ];
                (chatModule as any).chatHistory = fullHistory;

                const addMessageSpy = vi.spyOn(chatModule as any, 'addMessageToHistory');
                const newUserMessage = 'Observer test message';

                // Mock the HTTP response for the parallel completions call
                const requestMock = vi.spyOn(requestUtilMock, 'request');
                const mockHttpResponse: ChatCompletionResponse = { id: 'r-obs-1', object: 'chat.completion', created: 1, model: defaultChatOptions.model, choices: [{ index: 0, message: { role: 'assistant', content: 'HTTP Response' }, finish_reason: 'stop' }] };
                requestMock.mockResolvedValue(mockHttpResponse); // Assume non-streaming for this test setup

                // Act: Call send
                const result = await chatModule.send(newUserMessage);

                // Assert: Verify the observer was called
                expect(mockSendObserverText).toHaveBeenCalledTimes(1);
                
                // Assert: Check sendObserverText was called
                expect(mockSendObserverText).toHaveBeenCalledTimes(1);
                
                // Calculate expected history based on testHistorySize
                const expectedHistoryCount = Math.min(fullHistory.length, testHistorySize); // Should be 2
                const expectedHistoryMessages = fullHistory.slice(-expectedHistoryCount); // Should get last 2 messages

                // Instead of parsing the payload directly, verify the mock was called with a string that contains expected content
                expect(mockSendObserverText).toHaveBeenCalledWith(
                    expect.stringContaining(defaultChatOptions.systemMessage)
                );
                expect(mockSendObserverText).toHaveBeenCalledWith(
                    expect.stringContaining(newUserMessage)
                );
                expect(mockSendObserverText).toHaveBeenCalledWith(
                    expect.stringContaining(defaultChatOptions.model)
                );
                
                // Verify at least one history message is included
                if (expectedHistoryMessages.length > 0 && expectedHistoryMessages[0]?.content) {
                    expect(mockSendObserverText).toHaveBeenCalledWith(
                        expect.stringContaining(expectedHistoryMessages[0].content)
                    );
                }

                // Assert: Check that completions (HTTP) was also called
                expect(requestMock).toHaveBeenCalledTimes(1);
                expect(requestMock).toHaveBeenCalledWith(
                    'POST',
                    '/chat/completions',
                    { // Not using expect.objectContaining for more precise matching
                        model: defaultChatOptions.model,
                        messages: [ 
                           { role: 'system', content: defaultChatOptions.systemMessage },
                           { role: 'user', content: newUserMessage, timestamp: expect.any(String) }
                        ],
                        stream: false, 
                        compliance: true // Default from send -> completions
                    },
                    false
                );

                // Assert: History *is* updated by the successful HTTP call
                // Note: addAssistantResponseSpy is not called directly in send, but via completions
                const addAssistantResponseSpy = vi.spyOn(chatModule as any, 'addAssistantResponseToHistory');
                expect(addMessageSpy).toHaveBeenCalledTimes(1); // User message added by completions
                // We need to wait for the promise from send to resolve before checking assistant history
                await Promise.resolve(); // Allow microtasks to run
                expect(addAssistantResponseSpy).toHaveBeenCalledTimes(1); // Assistant message added by completions

                // Assert: The overall function should return the HTTP response
                expect(result).toEqual(mockHttpResponse);

                addMessageSpy.mockRestore();
                addAssistantResponseSpy.mockRestore();
                requestMock.mockRestore(); // Restore spy
            });

            it('should return HTTP result even if observer send fails', async () => {
                // Arrange: Set up observer mock to reject
                mockIsObserverConnected.mockReturnValue(true);
                mockSendObserverText.mockRejectedValue(new Error('Observer send failed')); // Mock observer failure

                // Mock the HTTP response for the parallel completions call
                const requestMock = vi.spyOn(requestUtilMock, 'request');
                const mockHttpResponse: ChatCompletionResponse = { id: 'r-obs-err', object: 'chat.completion', created: 1, model: defaultChatOptions.model, choices: [{ index: 0, message: { role: 'assistant', content: 'HTTP Fallback Response' }, finish_reason: 'stop' }] };
                requestMock.mockResolvedValue(mockHttpResponse); // Assume non-streaming

                const addMessageSpy = vi.spyOn(chatModule as any, 'addMessageToHistory');
                const addAssistantResponseSpy = vi.spyOn(chatModule as any, 'addAssistantResponseToHistory');
                const newUserMessage = 'Another observer test';

                // Act & Assert: Expect send NOT to throw (error is caught), but log it
                // The actual HTTP call should still proceed and its result returned
                const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); // Suppress console.error
                const result = await chatModule.send(newUserMessage);

                // Assert: Check console log, HTTP call, and history
                expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[Animus SDK] Background Observer send failed:'), 'Observer send failed');
                expect(requestMock).toHaveBeenCalledTimes(1); // HTTP call still happened
                // History is updated by the successful HTTP call
                expect(addMessageSpy).toHaveBeenCalledTimes(1);
                await Promise.resolve(); // Allow microtasks
                expect(addAssistantResponseSpy).toHaveBeenCalledTimes(1);
                expect(result).toEqual(mockHttpResponse); // Should return the HTTP response

                consoleErrorSpy.mockRestore();
                addMessageSpy.mockRestore();
                addAssistantResponseSpy.mockRestore();
                requestMock.mockRestore();
            });
        }); // End Observer Integration describe
      });

  });

  // --- End New Tests ---

  // --- Tests for Tool Calling ---
  describe('ChatModule - Tool Calling', () => {
    const sampleTools: Tool[] = [
      {
        type: "function",
        function: {
          name: "get_current_weather",
          description: "Get the current weather in a given location",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "The city and state, e.g. San Francisco, CA"
              },
              unit: {
                type: "string",
                enum: ["celsius", "fahrenheit"]
              }
            },
            required: ["location"]
          }
        }
      }
    ];

    it('should handle non-streaming completions with tool calls', async () => {
      chatModule = new ChatModule(
        requestUtilMock,
        { ...defaultChatOptions, historySize: 2 }, // Enable history
        mockIsObserverConnected,
        mockSendObserverText
      );

      const requestMock = vi.spyOn(requestUtilMock, 'request');
      const addAssistantResponseSpy = vi.spyOn(chatModule as any, 'addAssistantResponseToHistory');

      const mockToolCallId = "call_d5wg";
      const mockToolCalls: ToolCall[] = [{
        id: mockToolCallId,
        type: "function",
        function: {
          name: "get_current_weather",
          arguments: "{\"location\": \"Boston, MA\"}"
        }
      }];

      const mockApiResponse: ChatCompletionResponse = {
        id: 'chatcmpl-toolcall',
        object: 'chat.completion',
        created: Date.now(),
        model: defaultChatOptions.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null, // Content is null when tool_calls are present
            tool_calls: mockToolCalls
          },
          finish_reason: 'tool_calls'
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      };
      requestMock.mockResolvedValue(mockApiResponse);

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: "What's the weather in Boston?" }],
        tools: sampleTools
      };

      const response = await chatModule.completions(request);

      // 1. Verify requestUtil was called with tools and tool_choice: "auto"
      expect(requestMock).toHaveBeenCalledWith(
        'POST',
        '/chat/completions',
        expect.objectContaining({
          messages: expect.arrayContaining([
            { role: 'system', content: defaultChatOptions.systemMessage },
            { role: 'user', content: "What's the weather in Boston?", timestamp: expect.any(String) }
          ]),
          tools: sampleTools,
          tool_choice: "auto",
          model: defaultChatOptions.model,
          stream: false,
          compliance: true
        }),
        false
      );

      // 2. Verify the response from completions method
      expect(response).toEqual(mockApiResponse);
      expect(response.choices[0]?.message.tool_calls).toEqual(mockToolCalls);
      expect(response.choices[0]?.finish_reason).toBe('tool_calls');

      // 3. Verify history update
      expect(addAssistantResponseSpy).toHaveBeenCalledWith(
        null, // content
        undefined, // compliance_violations
        false, // isFromObserver
        mockToolCalls // tool_calls
      );

      const history = chatModule.getChatHistory();
      expect(history.length).toBe(2); // User message + Assistant tool_call message
      expect(history[0]?.role).toBe('user');
      expect(history[0]?.content).toBe("What's the weather in Boston?");
      expect(history[1]?.role).toBe('assistant');
      expect(history[1]?.content).toBeNull();
      expect(history[1]?.tool_calls).toEqual(mockToolCalls);
      expect(history[1]?.reasoning).toBeUndefined();


      // 4. Test sending a tool response message
      const toolResponseMessage: ChatMessage = {
        role: 'tool',
        tool_call_id: mockToolCallId,
        content: "{\"temperature\": \"22\", \"unit\": \"celsius\", \"description\": \"Sunny\"}"
      };

      // Mock the next API response (e.g., assistant's final answer)
      const mockFinalApiResponse: ChatCompletionResponse = {
        id: 'chatcmpl-finalanswer',
        object: 'chat.completion',
        created: Date.now(),
        model: defaultChatOptions.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: "The weather in Boston is 22 degrees Celsius and sunny.",
          },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
      };
      requestMock.mockResolvedValueOnce(mockFinalApiResponse); // Use Once for the next call

      const finalRequest: ChatCompletionRequest = {
        messages: [
            // User message is already in history from previous call
            // Assistant tool_call message is already in history
            toolResponseMessage // New tool message
        ],
        tools: sampleTools // It's common to send tools again
      };
      
      const finalResponse = await chatModule.completions(finalRequest);

      // Verify requestUtil for the second call
      expect(requestMock).toHaveBeenCalledWith(
        'POST',
        '/chat/completions',
        expect.objectContaining({
          messages: [ // System, Relevant History (Assistant tool_call), New ToolResponse
            { role: 'system', content: defaultChatOptions.systemMessage },
            // With historySize: 2 and 1 new message (toolResponseMessage), only 1 history item is included.
            // The history before this call is [User, Assistant(tool_call)]. The last one is Assistant(tool_call).
            { role: 'assistant', content: null, tool_calls: mockToolCalls }, // from history (no timestamp in payload for history items)
            toolResponseMessage // new message
          ],
          tools: sampleTools,
          tool_choice: "auto",
        }),
        false
      );
      expect(finalResponse).toEqual(mockFinalApiResponse);

      const finalHistory = chatModule.getChatHistory();
       // History: User1, Assistant1(tool_call), Tool1(response), Assistant2(final_answer)
       // historySize is 2, so it should be Tool1, Assistant2
      expect(finalHistory.length).toBe(2);
      expect(finalHistory[0]?.role).toBe('tool');
      expect(finalHistory[0]?.tool_call_id).toBe(mockToolCallId);
      expect(finalHistory[0]?.content).toBe("{\"temperature\": \"22\", \"unit\": \"celsius\", \"description\": \"Sunny\"}");
      expect(finalHistory[1]?.role).toBe('assistant');
      expect(finalHistory[1]?.content).toBe("The weather in Boston is 22 degrees Celsius and sunny.");


      requestMock.mockRestore();
      addAssistantResponseSpy.mockRestore();
    });

    it('should handle streaming completions with tool calls', async () => {
      chatModule = new ChatModule(
        requestUtilMock,
        { ...defaultChatOptions, historySize: 3 }, // Enable history
        mockIsObserverConnected,
        mockSendObserverText
      );

      const requestMock = vi.spyOn(requestUtilMock, 'request');
      const addAssistantResponseSpy = vi.spyOn(chatModule as any, 'addAssistantResponseToHistory');
      const addMessageSpy = vi.spyOn(chatModule as any, 'addMessageToHistory');


      const mockToolCallId = "call_stream_123";
      const expectedFinalToolCall: ToolCall = { // Corrected: No extra space in arguments
        id: mockToolCallId,
        type: "function",
        function: {
          name: "get_current_weather",
          arguments: "{\"location\":\"Streaming City, SC\"}"
        }
      };

      const mockStreamResponse = {
        ok: true,
        status: 200,
        body: new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            // Chunk 1: Role
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: 'chunk1', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`));
            await new Promise(r => setTimeout(r, 1));
            // Chunk 2: Tool call start (name, empty args)
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: 'chunk1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: mockToolCallId, type: "function", function: { name: "get_current_weather", arguments: "" } }] }, finish_reason: null }] })}\n\n`));
            await new Promise(r => setTimeout(r, 1));
            // Chunk 3: Argument part 1
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: 'chunk1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"location\":\"" } }] }, finish_reason: null }] })}\n\n`));
            await new Promise(r => setTimeout(r, 1));
            // Chunk 4: Argument part 2
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: 'chunk1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "Streaming City, SC" } }] }, finish_reason: null }] })}\n\n`));
            await new Promise(r => setTimeout(r, 1));
            // Chunk 5: Argument part 3 (closing) and finish_reason
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: 'chunk1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "\"}" } }] }, finish_reason: "tool_calls" }] })}\n\n`));
            await new Promise(r => setTimeout(r, 1));
            // Done signal
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        }),
        headers: new Headers({ 'Content-Type': 'text/event-stream' }),
      } as Response;

      requestMock.mockResolvedValue(mockStreamResponse);

      const request: ChatCompletionRequest & { stream: true } = {
        messages: [{ role: 'user', content: "Stream weather for Streaming City" }],
        tools: sampleTools,
        stream: true,
      };

      // Cast to unknown first to satisfy TypeScript when dealing with overloaded signatures
      const result = await chatModule.completions(request) as unknown as AsyncIterable<ChatCompletionChunk>;

      // 1. Verify requestUtil call
      expect(requestMock).toHaveBeenCalledWith(
        'POST',
        '/chat/completions',
        expect.objectContaining({
          tools: sampleTools,
          tool_choice: "auto",
          stream: true
        }),
        true
      );

      // 2. Consume stream and verify accumulated tool_calls
      const chunks: ChatCompletionChunk[] = [];
      let accumulatedToolCallsFromStream: ToolCall[] = [];
      let finalContentFromStream: string | null = ""; // Initialize as empty string

      for await (const chunk of result) {
        chunks.push(chunk);
        const delta = chunk.choices[0]?.delta;
        if (delta) {
            if (delta.content) {
                 if(finalContentFromStream === null && delta.content !== null) finalContentFromStream = ""; // Reset from null if content appears
                 if (delta.content !== null && finalContentFromStream !== null) finalContentFromStream += delta.content;
            }
            if (delta.tool_calls) {
                // The tcPart here is now (Partial<ToolCall> & { index: number; function?: Partial<ToolCall['function']> })
                delta.tool_calls.forEach(tcPart => {
                    const { index, ...toolCallDelta } = tcPart; // Separate index from the rest of the delta

                    // Ensure the accumulator has a slot for this index
                    while (accumulatedToolCallsFromStream.length <= index) {
                        accumulatedToolCallsFromStream.push({
                            id: `temp_id_${accumulatedToolCallsFromStream.length}`, // Placeholder ID
                            type: "function", // Default type
                            function: { name: "", arguments: "" }
                        });
                    }

                    const existingCall = accumulatedToolCallsFromStream[index]!;

                    // Merge delta into the existing/placeholder tool call
                    if (toolCallDelta.id) existingCall.id = toolCallDelta.id;
                    if (toolCallDelta.type) existingCall.type = toolCallDelta.type;

                    if (toolCallDelta.function) {
                        if (!existingCall.function) existingCall.function = { name: "", arguments: "" }; // Initialize if needed
                        if (toolCallDelta.function.name) existingCall.function.name = toolCallDelta.function.name;
                        if (toolCallDelta.function.arguments) {
                           // Argument streaming typically appends parts of a JSON string
                           if (existingCall.function.arguments === undefined || existingCall.function.arguments === null) {
                               existingCall.function.arguments = "";
                           }
                           existingCall.function.arguments += toolCallDelta.function.arguments;
                        }
                    }
                });
            }
            if (chunk.choices[0]?.finish_reason === 'tool_calls' && finalContentFromStream === "") {
                finalContentFromStream = null;
            }
        }
      }
      
      expect(chunks.length).toBe(5); // 5 data chunks
      expect(accumulatedToolCallsFromStream.length).toBe(1);
      expect(accumulatedToolCallsFromStream[0]).toEqual(expectedFinalToolCall);
      expect(finalContentFromStream).toBeNull(); // Content should be null due to tool_calls finish_reason

      // 3. Verify history update
      // User message added before stream
      expect(addMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', content: "Stream weather for Streaming City" }));

      // Assistant response (with tool_calls) added after stream
      expect(addAssistantResponseSpy).toHaveBeenCalledWith(
        null, // content
        undefined, // compliance_violations
        false, // isFromObserver
        [expectedFinalToolCall] // tool_calls
      );

      const history = chatModule.getChatHistory();
      expect(history.length).toBe(2); // User, Assistant (tool_call)
      expect(history[0]?.role).toBe('user');
      expect(history[1]?.role).toBe('assistant');
      expect(history[1]?.content).toBeNull();
      expect(history[1]?.tool_calls).toEqual([expectedFinalToolCall]);

      requestMock.mockRestore();
      addAssistantResponseSpy.mockRestore();
      addMessageSpy.mockRestore();
    });

    it('should send tool_choice: "none" when specified, even with tools present', async () => {
      chatModule = new ChatModule(
        requestUtilMock,
        { ...defaultChatOptions, historySize: 1 }, // Simple history for this test
        mockIsObserverConnected,
        mockSendObserverText
      );

      const requestMock = vi.spyOn(requestUtilMock, 'request');
      const addAssistantResponseSpy = vi.spyOn(chatModule as any, 'addAssistantResponseToHistory');

      // Mock a standard API response (no tool call)
      const mockApiResponse: ChatCompletionResponse = {
        id: 'chatcmpl-toolchoice-none',
        object: 'chat.completion',
        created: Date.now(),
        model: defaultChatOptions.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: "Okay, I will not use any tools for this request.",
          },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      };
      requestMock.mockResolvedValue(mockApiResponse);

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: "What's the weather, but please don't use tools." }],
        tools: sampleTools, // Tools are available
        tool_choice: "none"  // But explicitly ask the model not to use them
      };

      const response = await chatModule.completions(request);

      // 1. Verify requestUtil was called with tool_choice: "none"
      expect(requestMock).toHaveBeenCalledWith(
        'POST',
        '/chat/completions',
        expect.objectContaining({
          messages: expect.arrayContaining([
            { role: 'system', content: defaultChatOptions.systemMessage },
            { role: 'user', content: "What's the weather, but please don't use tools.", timestamp: expect.any(String) }
          ]),
          tools: sampleTools, // Tools are still sent
          tool_choice: "none", // Crucial assertion
          model: defaultChatOptions.model
        }),
        false // non-streaming
      );

      // 2. Verify the response is a standard message
      expect(response).toEqual(mockApiResponse);
      expect(response.choices[0]?.message.tool_calls).toBeUndefined();
      expect(response.choices[0]?.message.content).toBe("Okay, I will not use any tools for this request.");
      expect(response.choices[0]?.finish_reason).toBe('stop');

      // 3. Verify history update for a standard assistant message
      expect(addAssistantResponseSpy).toHaveBeenCalledWith(
        "Okay, I will not use any tools for this request.", // content
        undefined, // compliance_violations
        false, // isFromObserver
        undefined // tool_calls
      );

      const history = chatModule.getChatHistory();
      expect(history.length).toBe(1); // User message + Assistant message (historySize is 1 for this test setup after user + assistant)
                                      // Actually, historySize 1 means only the last message.
                                      // After user + assistant, history will be [assistant]
      // Let's re-init with historySize: 2 for clarity on user + assistant
      chatModule = new ChatModule( requestUtilMock, { ...defaultChatOptions, historySize: 2 }, mockIsObserverConnected, mockSendObserverText );
      // Clear spies and mocks for the re-run part of this test logic
      requestMock.mockClear();
      addAssistantResponseSpy.mockClear();
      vi.spyOn(chatModule as any, 'addMessageToHistory'); // Re-spy on addMessageToHistory for the new instance
      const newAddAssistantResponseSpy = vi.spyOn(chatModule as any, 'addAssistantResponseToHistory');


      requestMock.mockResolvedValue(mockApiResponse); // Re-mock response for the new instance call
      await chatModule.completions(request); // Call again with historySize 2

      const updatedHistory = chatModule.getChatHistory();
      expect(updatedHistory.length).toBe(2);
      expect(updatedHistory[0]?.role).toBe('user');
      expect(updatedHistory[1]?.role).toBe('assistant');
      expect(updatedHistory[1]?.content).toBe("Okay, I will not use any tools for this request.");
      expect(updatedHistory[1]?.tool_calls).toBeUndefined();

      requestMock.mockRestore();
      addAssistantResponseSpy.mockRestore(); // Restore original spy
      newAddAssistantResponseSpy.mockRestore(); // Restore new spy
    });

    it('should use tools from config and default tool_choice to "auto" if not in request', async () => {
      // Configure ChatModule with default tools
      const chatOptionsWithTools: AnimusChatOptions = {
        ...defaultChatOptions,
        tools: sampleTools, // Tools defined in the initial config
        historySize: 2
      };
      chatModule = new ChatModule(
        requestUtilMock,
        chatOptionsWithTools,
        mockIsObserverConnected,
        mockSendObserverText
      );

      const requestMock = vi.spyOn(requestUtilMock, 'request');
      const addAssistantResponseSpy = vi.spyOn(chatModule as any, 'addAssistantResponseToHistory');

      const mockToolCallId = "call_config_tools";
      const mockToolCalls: ToolCall[] = [{
        id: mockToolCallId,
        type: "function",
        function: { name: "get_current_weather", arguments: "{\"location\": \"Config City, CC\"}" }
      }];
      const mockApiResponse: ChatCompletionResponse = {
        id: 'chatcmpl-config-toolcall',
        object: 'chat.completion',
        created: Date.now(),
        model: defaultChatOptions.model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: null, tool_calls: mockToolCalls },
          finish_reason: 'tool_calls'
        }],
      };
      requestMock.mockResolvedValue(mockApiResponse);

      // Request does NOT specify tools or tool_choice
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: "What's the weather in Config City?" }],
      };

      const response = await chatModule.completions(request);

      // 1. Verify requestUtil was called with tools from config and tool_choice: "auto"
      expect(requestMock).toHaveBeenCalledWith(
        'POST',
        '/chat/completions',
        expect.objectContaining({
          messages: expect.arrayContaining([
            { role: 'system', content: defaultChatOptions.systemMessage },
            { role: 'user', content: "What's the weather in Config City?", timestamp: expect.any(String) }
          ]),
          tools: sampleTools, // Assert tools from config are used
          tool_choice: "auto", // Assert tool_choice defaults to "auto"
          model: defaultChatOptions.model
        }),
        false // non-streaming
      );

      // 2. Verify the response indicates a tool call
      expect(response.choices[0]?.message.tool_calls).toEqual(mockToolCalls);
      expect(response.choices[0]?.finish_reason).toBe('tool_calls');

      // 3. Verify history update
      expect(addAssistantResponseSpy).toHaveBeenCalledWith(
        null,
        undefined,
        false,
        mockToolCalls
      );
      const history = chatModule.getChatHistory();
      expect(history.length).toBe(2);
      expect(history[1]?.tool_calls).toEqual(mockToolCalls);

      requestMock.mockRestore();
      addAssistantResponseSpy.mockRestore();
    });

  });
});