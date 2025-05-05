const chatWindow = document.getElementById('chat-window');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const statusTextElement = document.getElementById('status-text');
const connectButton = document.getElementById('connect-button');
const disconnectButton = document.getElementById('disconnect-button');
// Config Panel Elements
const systemPromptInput = document.getElementById('system-prompt-input');
const historySizeInput = document.getElementById('history-size-input');
const maxTokensInput = document.getElementById('max-tokens-input');
const temperatureInput = document.getElementById('temperature-input');
const streamInput = document.getElementById('stream-input');
const complianceInput = document.getElementById('compliance-input');

// Global client instance and its current config
let client = null;
let currentChatConfig = {}; // Store the active chat config
let currentComplianceConfig = {}; // Store the active compliance config (example)

// Simple log to console
function logOutput(message, isError = false) {
    const prefix = isError ? "ERROR:" : "INFO:";
    if (typeof message === 'object') {
        console.log(prefix, message);
    } else {
        console.log(`${prefix} ${message}`);
    }
}

function updateStatus(message, isError = false) {
    statusTextElement.textContent = message;
    statusTextElement.classList.toggle('error', isError);
}

function updateConnectionButtons(state) {
    const isConnected = state === 'connected';
    const isConnecting = state === 'connecting' || state === 'reconnecting';
    const isDisconnected = state === 'disconnected';

    connectButton.disabled = isConnected || isConnecting;
    disconnectButton.disabled = isDisconnected || isConnecting;
}

// Updated to use Tailwind classes
function addMessageToChat(role, text) {
    const messageElement = document.createElement('div');
    // Base classes for all messages
    messageElement.classList.add('p-2', 'px-4', 'rounded-lg', 'max-w-[80%]', 'break-words', 'leading-snug', 'message'); // Added 'message' back

    if (role === 'user') {
        messageElement.classList.add('self-end', 'bg-blue-500', 'text-white', 'rounded-br-none', 'user'); // Added 'user'
    } else { // assistant or typing indicator base
        messageElement.classList.add('self-start', 'bg-gray-200', 'text-gray-800', 'rounded-bl-none', 'whitespace-pre-wrap', 'assistant'); // Added 'assistant'
    }

    messageElement.textContent = text; // Use textContent for security
    chatWindow.appendChild(messageElement);
    // Scroll to the bottom smoothly
    chatWindow.scrollTo({ top: chatWindow.scrollHeight, behavior: 'smooth' });
    return messageElement; // Return for streaming updates
}


function setInputEnabled(enabled, statusMessage = null) {
    messageInput.disabled = !enabled;
    sendButton.disabled = !enabled;
    if (enabled) {
        messageInput.placeholder = "Type your message...";
        if (statusMessage !== 'Sending to AI...' && statusMessage !== 'AI is thinking...') {
           // Avoid stealing focus right after sending
        }
    } else {
        messageInput.placeholder = statusMessage || "Waiting...";
    }
}

async function initializeAndTest() {
    logOutput('Initializing AnimusClient...');
    updateStatus('SDK Initialized - Disconnected');
    setInputEnabled(true);
    updateConnectionButtons('disconnected');

    if (typeof AnimusSDK === 'undefined' || typeof AnimusSDK.AnimusClient === 'undefined') {
        const errorMsg = 'Error: AnimusSDK not found. Check script path and build.';
        logOutput(errorMsg, true);
        updateStatus(errorMsg, true);
        return;
    }

    const tokenProviderUrl = 'http://localhost:3001/token';

    try {
        // --- Read initial config FROM the form elements ---
        const initialChatOptions = {
            model: 'vivian-llama3.1-70b-1.0-fp8',
            systemMessage: systemPromptInput.value,
            historySize: parseInt(historySizeInput.value, 10) || 30,
            temperature: parseFloat(temperatureInput.value) || 0.7,
            stream: streamInput.checked, // Read stream preference
            maxTokens: parseInt(maxTokensInput.value, 10) || 1024
        };
        const initialComplianceOptions = { enabled: complianceInput.checked };

        // --- Instantiate the client with config read from form ---
        client = new AnimusSDK.AnimusClient({
            tokenProviderUrl: tokenProviderUrl,
            chat: initialChatOptions,
            observer: {
                enabled: true // Keep observer enabled by default for this example
            },
            compliance: initialComplianceOptions
        });
        logOutput('Client initialized using form defaults. Setting up listeners...');

        // --- Store the successfully used initial config ---
        currentChatConfig = { ...initialChatOptions };
        currentComplianceConfig = { ...initialComplianceOptions };


        // --- Observer Connection Status Event Listeners (Keep these) ---
        client.on('observerConnecting', () => {
            logOutput('Observer connecting...');
            updateStatus('Connecting to Agent...');
            updateConnectionButtons('connecting');
        });
        client.on('observerConnected', () => {
            logOutput('Observer connected!');
            updateStatus('Connected - Ready to Chat');
            setInputEnabled(true);
            updateConnectionButtons('connected');
        });
        client.on('observerDisconnected', (reason) => {
            const msg = `Disconnected: ${reason || 'Unknown reason'}`;
            logOutput(msg, true);
            updateStatus(msg, reason && reason !== 'User disconnected');
            setInputEnabled(true);
            updateConnectionButtons('disconnected');
        });
         client.on('observerReconnecting', () => {
            logOutput('Observer reconnecting...');
            updateStatus('Reconnecting...');
            updateConnectionButtons('reconnecting');
        });
        client.on('observerReconnected', () => {
            logOutput('Observer reconnected!');
            updateStatus('Reconnected - Ready to Chat');
            setInputEnabled(true);
            updateConnectionButtons('connected');
        });
        client.on('observerError', (errorMsg) => { // Listener name matches definition
            const msg = `Connection Error: ${errorMsg}`;
            logOutput(msg, true);
            updateStatus(msg, true);
            // Let disconnect handler manage button state if error causes disconnect
        });

        // --- Observer Stream Event Listeners (NEW - Handle proactive observer responses) ---
        let observerAssistantMessageElement = null; // Track the OBSERVER's message bubble

        client.on('observerChunk', (data) => {
            logOutput(`Received observerChunk (Participant: ${data.participantIdentity}):`, data.chunk);
            // Note: We don't remove the main typing indicator here, as the HTTP stream might still be starting.
            // The observer response is treated as a separate, potentially faster response.

            // Create or find the observer message bubble
            if (!observerAssistantMessageElement) {
                // Maybe create a bubble with a specific ID or class?
                observerAssistantMessageElement = addMessageToChat('assistant', '[Observer]: '); // Start with a prefix
                observerAssistantMessageElement.classList.add('border', 'border-purple-400'); // Style differently
                // Don't update main status bar for observer-only chunks yet
            }

            // Append delta content
            if (data.deltaContent) {
                observerAssistantMessageElement.textContent += data.deltaContent;
            }

            // Scroll to keep the latest content visible
            chatWindow.scrollTo({ top: chatWindow.scrollHeight, behavior: 'smooth' });

            // Handle compliance violations if present
            if (data.compliance_violations && data.compliance_violations.length > 0) {
                 console.warn("Observer Compliance violation detected mid-stream:", data.compliance_violations);
                 if (observerAssistantMessageElement) {
                     observerAssistantMessageElement.classList.add('border-2', 'border-red-500');
                 }
            }
        });

        client.on('observerComplete', (data) => {
            logOutput(`Received observerComplete (Participant: ${data.participantIdentity}):`, data);

            // Finalize observer message bubble state
            if (observerAssistantMessageElement) {
                 if (data.compliance_violations && data.compliance_violations.length > 0) {
                     console.warn("Observer Stream completed with compliance violations:", data.compliance_violations);
                     observerAssistantMessageElement.classList.add('border-2', 'border-red-500', 'opacity-75');
                 }
                 // Add final checks or styling if needed
            }
            observerAssistantMessageElement = null; // Reset observer message element tracker
            // Don't re-enable input or change main status here, let the HTTP response/stream handler do that.
        });

        client.on('observerStreamError', (data) => {
            logOutput(`Received observerStreamError (Participant: ${data.participantIdentity}):`, data.error, true);

            // Display error in a new chat bubble, clearly marked
            const errorBubble = addMessageToChat('assistant', `--- OBSERVER STREAM ERROR (${data.participantIdentity}): ${data.error} ---`);
            errorBubble.classList.add('bg-red-100', 'text-red-700', 'border', 'border-red-400');

            observerAssistantMessageElement = null; // Reset observer message element tracker
            // Don't re-enable input or change main status here.
        });


        // --- Send Logic (NEW - Handles AsyncIterable for HTTP stream) ---
        let httpAssistantMessageElement = null; // Track the HTTP assistant message bubble
        let typingIndicatorElement = null; // Track the typing indicator bubble

        // Function to remove the typing indicator
        function removeTypingIndicator() {
            if (typingIndicatorElement) {
                typingIndicatorElement.remove();
                typingIndicatorElement = null;
            }
        }

        async function sendMessage() {
            httpAssistantMessageElement = null; // Reset HTTP tracker
            observerAssistantMessageElement = null; // Reset Observer tracker too
            const userMessage = messageInput.value.trim();
            if (!userMessage || sendButton.disabled) return;

            logOutput(`Sending: "${userMessage}"`);
            addMessageToChat('user', userMessage); // Uses Tailwind classes
            messageInput.value = '';
            messageInput.style.height = 'auto';
            messageInput.focus();

            setInputEnabled(false, 'Sending to AI...');
            updateStatus('Sending to AI...');

            // Add typing indicator
            typingIndicatorElement = addMessageToChat('assistant', 'Assistant is typing');
            typingIndicatorElement.classList.remove('bg-gray-200', 'text-gray-800');
            typingIndicatorElement.classList.add('bg-gray-100', 'text-gray-500', 'italic');

            // Determine if streaming is enabled based on the checkbox
            const isStreaming = streamInput.checked;

            try {
                // Call send, passing the current stream preference in options
                const responseOrStream = await client.chat.send(userMessage, { stream: isStreaming });

                if (isStreaming && typeof responseOrStream[Symbol.asyncIterator] === 'function') {
                    // --- Handle HTTP Stream ---
                    logOutput("Receiving HTTP stream...");
                    updateStatus('AI is responding (HTTP Stream)...');
                    httpAssistantMessageElement = null; // Ensure it's null before starting

                    for await (const chunk of responseOrStream) {
                        logOutput("HTTP Chunk:", chunk);
                        removeTypingIndicator(); // Remove indicator on first chunk

                        // Create message bubble if it doesn't exist
                        if (!httpAssistantMessageElement) {
                            httpAssistantMessageElement = addMessageToChat('assistant', ''); // Base assistant styles
                        }

                        const deltaContent = chunk.choices?.[0]?.delta?.content;
                        if (deltaContent) {
                            httpAssistantMessageElement.textContent += deltaContent;
                        }

                        // Scroll to keep the latest content visible
                        chatWindow.scrollTo({ top: chatWindow.scrollHeight, behavior: 'smooth' });

                        // Handle compliance violations (unlikely in chunks, but check)
                        if (chunk.compliance_violations && chunk.compliance_violations.length > 0) {
                            console.warn("HTTP Stream: Compliance violation detected mid-stream:", chunk.compliance_violations);
                            if (httpAssistantMessageElement) {
                                httpAssistantMessageElement.classList.add('border-2', 'border-red-500');
                            }
                        }
                    }
                    // Stream finished successfully
                    logOutput("HTTP Stream finished.");
                    // Finalize bubble state (e.g., check final compliance if needed, though SDK handles history)
                    if (httpAssistantMessageElement) {
                        // Add final styling if needed based on accumulated state or final chunk info
                    }
                    httpAssistantMessageElement = null; // Reset tracker
                    setInputEnabled(true, 'Connected - Ready to Chat');
                    updateStatus('Connected - Ready to Chat');

                } else if (!isStreaming && responseOrStream && typeof responseOrStream === 'object' && 'choices' in responseOrStream) {
                    // --- Handle Non-Streaming HTTP Response ---
                    const response = responseOrStream; // No type assertion needed in JS
                    logOutput("Received Non-Streaming HTTP Response:", false);
                    removeTypingIndicator(); // Remove indicator

                    const responseText = response.choices?.[0]?.message?.content || JSON.stringify(response);
                    logOutput("HTTP Response Content:", responseText);

                    // Check for compliance violations
                    if (response.compliance_violations && response.compliance_violations.length > 0) {
                         console.warn("HTTP response has compliance violations:", response.compliance_violations);
                         const violationBubble = addMessageToChat('assistant', `[Content Moderation: ${response.compliance_violations.join(', ')}]`);
                         violationBubble.classList.add('bg-red-100', 'text-red-700', 'italic');
                         // SDK prevents adding to history automatically
                    } else {
                         addMessageToChat('assistant', responseText); // Add valid response
                    }

                    updateStatus('Connected - Ready to Chat');
                    setInputEnabled(true, 'Connected - Ready to Chat');
                } else {
                     // Should not happen with the new logic, but log if it does
                     logOutput("Unexpected response type from client.chat.send()", true);
                     removeTypingIndicator();
                     updateStatus('Unexpected response from SDK', true);
                     setInputEnabled(true, 'Connected - Ready to Chat');
                }

            } catch (error) {
                logOutput(`Error sending message: ${error.message || error}`, true);
                updateStatus(`Send Error: ${error.message || 'Unknown error'}`, true);
                removeTypingIndicator();
                const errorBubble = addMessageToChat('assistant', `--- SEND ERROR: ${error.message || error} ---`);
                errorBubble.classList.add('bg-red-100', 'text-red-700');
                setInputEnabled(true, 'Connected - Ready to Chat');
            }
        }

        sendButton.onclick = sendMessage;
        messageInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        });
        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            let scrollHeight = messageInput.scrollHeight;
            const maxHeight = 100;
            if (scrollHeight > maxHeight) {
                messageInput.style.height = maxHeight + 'px';
                messageInput.style.overflowY = 'auto';
            } else {
                messageInput.style.height = scrollHeight + 'px';
                messageInput.style.overflowY = 'hidden';
            }
        });

        // --- Manual Connection Button Handlers ---
        connectButton.onclick = async () => {
            if (!client.options?.observer?.enabled) {
                 updateStatus("Observer not enabled in SDK config.", true);
                 return;
            }
            logOutput("Manual connect initiated...");
            updateStatus("Connecting...");
            updateConnectionButtons('connecting');
            try {
                await client.connectObserverManually(); // Use manual connect method
            } catch (error) {
                const errorMsg = `Manual Connect Failed: ${error instanceof Error ? error.message : String(error)}`;
                logOutput(errorMsg, true);
                updateStatus(errorMsg, true);
                updateConnectionButtons('disconnected');
            }
        };
        disconnectButton.onclick = async () => {
            logOutput("Manual disconnect initiated...");
            updateStatus("Disconnecting...");
            updateConnectionButtons('disconnecting');
            try {
                await client.disconnectObserverManually(); // Use manual disconnect method
                // Status update handled by 'observerDisconnected' event listener
            } catch (error) {
                const errorMsg = `Disconnect Failed: ${error instanceof Error ? error.message : String(error)}`;
                logOutput(errorMsg, true);
                updateStatus(errorMsg, true);
                updateConnectionButtons('connected'); // Assume still connected if disconnect fails
            }
        };

        // Note: Connection is now manual
        logOutput('SDK Initialized. Observer connection requires manual initiation.');

    } catch (error) { // Catch initialization errors
        const errorMsg = `Fatal Initialization Error: ${error.message || error}`;
        logOutput(errorMsg, true);
        updateStatus(errorMsg, true);
        if (error instanceof AnimusSDK.AuthenticationError) {
            logOutput(`Authentication Error Details: ${error.message}`, true);
        } else if (error instanceof AnimusSDK.ApiError) {
            logOutput(`API Error Details (${error.status}): ${error.message}`, true);
            logOutput(error.errorData, true);
        } else if (error instanceof Error) {
            logOutput(`Stack Trace: ${error.stack}`, true);
        }
    }
}

// Call the initialization function when the script loads
initializeAndTest();