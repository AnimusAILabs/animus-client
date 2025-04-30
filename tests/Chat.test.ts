import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'; // Add beforeEach, afterEach
import { ChatModule, ChatCompletionRequest, ChatCompletionChunk, ChatCompletionResponse } from '../src/Chat';
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
    mockIsObserverConnected.mockReturnValue(false); // Ensure default is false

    // Default instantiation using mocks
    chatModule = new ChatModule(
        requestUtilMock,
        defaultChatOptions,
        mockIsObserverConnected,
        mockSendObserverText
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
    expect(addMessageSpy).toHaveBeenCalledWith({ role: 'user', content: 'Say hello' });

    // 2. Check if requestUtil was called correctly
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
    expect(addAssistantResponseSpy).toHaveBeenCalledWith('Hello world!', undefined); // Expect undefined for compliance_violations

    // 6. Verify final history state (addMessageToHistory handles trimming internally)
    // Access history AFTER spies have been checked
    const finalHistory = (chatModule as any).chatHistory;
    expect(finalHistory).toEqual([
        { role: 'user', content: 'Say hello' },
        { role: 'assistant', content: 'Hello world!' } // Assuming addMessageToHistory cleaned it if needed
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
    // Expected Payload: System + History BEFORE User2 (User1, Assistant1) + User2
    // History before call: [User1, Assistant1]. historySize=2. Max past history = 2-1=1. Actual past = min(2,1)=1. History to add = [Assistant1].
    expect(requestMock).toHaveBeenCalledWith('POST', '/chat/completions', expect.objectContaining({
      messages: [
        { role: 'system', content: 'System prompt.' },
        { role: 'assistant', content: 'Response 1' }, // Only Assistant1 fits
        { role: 'user', content: 'User message 2' }
      ]
    }), false);
     // Final History State Check: [User2, Assistant2] (This part remains correct)
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
     // Expected Payload: System + History BEFORE User3 (User2, Assistant2) + User3
     // History before call: [User2, Assistant2]. historySize=2. Max past history = 2-1=1. Actual past = min(2,1)=1. History to add = [Assistant2].
    expect(requestMock).toHaveBeenCalledWith('POST', '/chat/completions', expect.objectContaining({
      messages: [
        { role: 'system', content: 'System prompt.' },
        { role: 'assistant', content: 'Response 2' }, // Only Assistant2 fits
        { role: 'user', content: 'User message 3' }
      ]
    }), false);
    // Final History State Check: [User3, Assistant3] (This part remains correct)
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
        messages: [{ role: 'user', content: 'Minimal request' }],
      };

      await chatModule.completions(request);

      expect(requestMock).toHaveBeenCalledWith(
        'POST',
        '/chat/completions',
        {
          model: 'default-model',
          messages: [
            { role: 'system', content: 'Default system' },
            { role: 'user', content: 'Minimal request' }
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
          expect.objectContaining({
            model: 'default-model-send',
            temperature: 0.4,
            max_tokens: 99,
            compliance: true, // Check default is applied
            stream: false, // send() always sets stream to false
          }),
          false
        );
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
          messages: [{ role: 'user', content: 'Check compliance default' }],
          // No compliance specified here either
        };

        // Call completions
        const response = await chatModule.completions(request);

        // 1. Check compliance: true was sent
        expect(requestMock).toHaveBeenCalledWith(
          'POST',
          '/chat/completions',
          expect.objectContaining({
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
          messages: [{ role: 'user', content: 'Turn off compliance' }],
          compliance: false // Explicitly disable compliance for this request
        };

        const response = await chatModule.completions(request);

        // 1. Check compliance: false was sent
        expect(requestMock).toHaveBeenCalledWith(
          'POST',
          '/chat/completions',
          expect.objectContaining({
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
            compliance: false, // Should be false as requested in options
          }),
          false
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
        messages: [{ role: 'user', content: 'Override request' }],
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
        expect.objectContaining({
          model: 'override-model', // Check override
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
          reasoning: expectedReasoning
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
            content: '', // Content should be empty
            reasoning: 'Only reasoning here.'
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
            reasoning: undefined // No reasoning field expected
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
            top_p: 0.7                  // New param, not in defaults
        });
        
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
                    { role: 'user', content: 'User message 1' },
                    { role: 'assistant', content: 'Assistant message 1' },
                    { role: 'user', content: 'User message 2' },
                    { role: 'assistant', content: 'Assistant message 2' } // 4 messages total
                ];
                (chatModule as any).chatHistory = fullHistory;

                const addMessageSpy = vi.spyOn(chatModule as any, 'addMessageToHistory');
                const newUserMessage = 'Observer test message';

                // Act: Call send
                await chatModule.send(newUserMessage);

                // Assert: Check sendObserverText payload
                expect(mockSendObserverText).toHaveBeenCalledTimes(1);

                // Calculate expected history based on testHistorySize
                const expectedHistoryCount = Math.min(fullHistory.length, testHistorySize); // Should be 2
                const expectedHistoryMessages = fullHistory.slice(-expectedHistoryCount); // Should get last 2 messages

                // Assert the payload sent to the observer
                const expectedPayload = {
                    messages: [
                        { role: 'system', content: defaultChatOptions.systemMessage },
                        ...expectedHistoryMessages, // Include the calculated history slice
                        { role: 'user', content: newUserMessage } // New user message
                    ],
                    llm_params: { // Check default params are included
                        model: defaultChatOptions.model
                        // Add other expected default llm_params if configured
                    }
                };
                expect(mockSendObserverText).toHaveBeenCalledWith(JSON.stringify(expectedPayload));

                // Assert user message was added to internal history (this part remains the same)
                expect(addMessageSpy).toHaveBeenCalledTimes(1);
                expect(addMessageSpy).toHaveBeenCalledWith({ role: 'user', content: newUserMessage });

                addMessageSpy.mockRestore();
            });

            it('should throw error from sendObserverText and NOT update history', async () => {
                mockIsObserverConnected.mockReturnValue(true); // Set observer connected for this test
                const addMessageSpy = vi.spyOn(chatModule as any, 'addMessageToHistory');
                const message = 'Hello Observer Fail';
                const testError = new ApiError('Observer send failed', 0);
                mockSendObserverText.mockRejectedValue(testError); // Simulate failure

                await expect(chatModule.send(message)).rejects.toThrow(testError);

                // Verify send was attempted
                expect(mockIsObserverConnected).toHaveBeenCalledTimes(1);
                expect(mockSendObserverText).toHaveBeenCalledTimes(1);
                expect(mockSendObserverText).toHaveBeenCalledWith(expect.stringContaining(`"content":"${message}"`));
                expect(requestUtilMock.request).not.toHaveBeenCalled();

                // Verify history was NOT updated
                expect(addMessageSpy).not.toHaveBeenCalled();

                addMessageSpy.mockRestore();
            });
        }); // End Observer Integration describe

        expect(requestMock).toHaveBeenCalledWith(
          'POST',
          '/chat/completions',
          expect.objectContaining({
            model: 'override-model-send', // Check override
            temperature: 0.1,           // Check override
            max_tokens: 200,            // Check override
            compliance: false,          // Check override
            top_p: 0.7,                 // Check new param is included
            stream: false,              // send() always sets stream to false
          }),
          false
        );
        requestMock.mockRestore();
      });

  });

  // --- End New Tests ---

});