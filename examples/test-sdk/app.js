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
const reasoningInput = document.getElementById('reasoning-input');
const imageGenerationInput = document.getElementById('image-generation-input');
const autoTurnInput = document.getElementById('auto-turn-input');
const toolsInput = document.getElementById('tools-input');

// Conversational Turns Advanced Settings Elements
const toggleTurnsSettingsButton = document.getElementById('toggle-turns-settings');
const turnsSettingsContent = document.getElementById('turns-settings-content');
const toggleTurnsText = document.getElementById('toggle-turns-text');
const splitProbabilityInput = document.getElementById('split-probability-input');
const shortSentenceThresholdInput = document.getElementById('short-sentence-threshold-input');
const baseTypingSpeedInput = document.getElementById('base-typing-speed-input');
const speedVariationInput = document.getElementById('speed-variation-input');
const minDelayInput = document.getElementById('min-delay-input');
const maxDelayInput = document.getElementById('max-delay-input');

// Global client instance and its current config
let client = null;
let currentChatConfig = {}; // Store the active chat config
let currentComplianceConfig = {}; // Store the active compliance config (example)

// Simple log to console
function logOutput(message, isError = false) {
    const prefix = isError ? "ERROR:" : "INFO:";
    if (typeof message === 'object') {
        console.log(prefix);
        console.log(message);
    } else {
        console.log(`${prefix} ${message}`);
    }
}

function updateStatus(message, isError = false) {
    // Check if the element exists before trying to use it
    if (statusTextElement) {
        statusTextElement.textContent = message;
        statusTextElement.classList.toggle('error', isError);
    } else {
        // Just log to console if the element doesn't exist
        const prefix = isError ? "STATUS ERROR:" : "STATUS:";
        console.log(`${prefix} ${message}`);
    }
}

function updateConnectionButtons(state) {
    const isConnected = state === 'connected';
    const isConnecting = state === 'connecting' || state === 'reconnecting';
    const isDisconnected = state === 'disconnected';

    // Check if elements exist before trying to use them
    if (connectButton) {
        connectButton.disabled = isConnected || isConnecting;
    }
    
    if (disconnectButton) {
        disconnectButton.disabled = isDisconnected || isConnecting;
    }
}

// Updated to use Tailwind classes
function addMessageToChat(role, text) {
    const messageElement = document.createElement('div');
    // Base classes for all messages
    messageElement.classList.add('p-2', 'px-4', 'rounded-lg', 'max-w-[80%]', 'break-words', 'leading-snug', 'message', 'border'); // Added 'border' class

    if (role === 'user') {
        messageElement.classList.add('self-end', 'bg-blue-500', 'text-white', 'rounded-br-none', 'user', 'border-transparent'); // Added 'user' and transparent border
    } else { // assistant or typing indicator base
        messageElement.classList.add('self-start', 'bg-gray-200', 'text-gray-800', 'rounded-bl-none', 'whitespace-pre-wrap', 'assistant', 'border-transparent'); // Added 'assistant' and transparent border
    }

    messageElement.textContent = text; // Use textContent for security
    chatWindow.appendChild(messageElement);
    // Scroll to the bottom smoothly
    chatWindow.scrollTo({ top: chatWindow.scrollHeight, behavior: 'smooth' });
    return messageElement; // Return for streaming updates
}

// Helper functions for conversational turns
function addMessage(role, text, reasoning = null, messageType = null) {
    const messageElement = addMessageToChat(role, text);
    
    // Add special styling for different message types
    if (messageType === 'turn-indicator') {
        messageElement.classList.remove('bg-gray-200', 'text-gray-800');
        messageElement.classList.add('bg-blue-100', 'text-blue-600', 'italic', 'border-blue-300');
        messageElement.dataset.turnIndicator = 'true';
    } else if (messageType === 'turn-canceled') {
        messageElement.classList.remove('bg-gray-200', 'text-gray-800');
        messageElement.classList.add('bg-red-100', 'text-red-600', 'italic', 'border-red-300');
    }
    
    // Handle reasoning if present
    if (reasoning) {
        const reasoningElement = document.createElement('div');
        reasoningElement.classList.add('mt-2', 'p-2', 'bg-gray-100', 'rounded', 'text-sm', 'text-gray-600', 'italic');
        reasoningElement.textContent = `Reasoning: ${reasoning}`;
        messageElement.appendChild(reasoningElement);
    }
    
    return messageElement;
}

function removeLastTurnIndicator() {
    const turnIndicators = chatWindow.querySelectorAll('[data-turn-indicator="true"]');
    if (turnIndicators.length > 0) {
        const lastIndicator = turnIndicators[turnIndicators.length - 1];
        lastIndicator.remove();
    }
}

function removeAllTurnIndicators() {
    const turnIndicators = chatWindow.querySelectorAll('[data-turn-indicator="true"]');
    turnIndicators.forEach(indicator => indicator.remove());
}

function setInputEnabled(enabled, statusMessage = null) {
    // Check if elements exist before trying to use them
    if (messageInput) {
        messageInput.disabled = !enabled;
        if (enabled) {
            messageInput.placeholder = "Type your message...";
            if (statusMessage !== 'Sending to AI...' && statusMessage !== 'AI is thinking...') {
               // Avoid stealing focus right after sending
            }
        } else {
            messageInput.placeholder = statusMessage || "Waiting...";
        }
    }
    
    if (sendButton) {
        sendButton.disabled = !enabled;
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
        const initialConversationalTurnsConfig = {
            enabled: autoTurnInput.checked,
            splitProbability: parseFloat(splitProbabilityInput.value) || 1.0,
            shortSentenceThreshold: parseInt(shortSentenceThresholdInput.value, 10) || 30,
            baseTypingSpeed: parseInt(baseTypingSpeedInput.value, 10) || 45,
            speedVariation: parseFloat(speedVariationInput.value) || 0.2,
            minDelay: parseInt(minDelayInput.value, 10) || 500,
            maxDelay: parseInt(maxDelayInput.value, 10) || 3000
        };

        const initialChatOptions = {
            model: 'animafmngvy7-xavier-r1',
            systemMessage: systemPromptInput.value,
            historySize: parseInt(historySizeInput.value, 10) || 30,
            temperature: parseFloat(temperatureInput.value) || 0.7,
            stream: streamInput.checked, // Read stream preference
            maxTokens: parseInt(maxTokensInput.value, 10) || 1024,
            reasoning: reasoningInput.checked, // Read reasoning preference
            tools: undefined, // Placeholder, will be set below
            // Use object configuration for autoTurn to include detailed settings
            autoTurn: autoTurnInput.checked ? initialConversationalTurnsConfig : false
        };

        // Parse tools
        // try {
        //     const toolsJson = toolsInput.value.trim();
        //     if (toolsJson) {
        //         const parsedTools = JSON.parse(toolsJson);
        //         if (Array.isArray(parsedTools)) {
        //             initialChatOptions.tools = parsedTools;
        //             logOutput("Successfully parsed tools from UI.", parsedTools);
        //         } else {
        //             logOutput("Tools input is not a valid JSON array. Ignoring.", true);
        //         }
        //     }
        // } catch (e) {
        //     logOutput(`Error parsing tools JSON: ${e.message}. Ignoring tools input.`, true);
        // }

        const initialComplianceOptions = { enabled: complianceInput.checked };

        // --- Instantiate the client with config read from form ---
        client = new AnimusSDK.AnimusClient({
            apiBaseUrl: 'https://api-dev.animusai.co/v3',
            tokenProviderUrl: tokenProviderUrl,
            chat: initialChatOptions,
            compliance: initialComplianceOptions
        });
        logOutput('Client initialized using form defaults. Setting up listeners...');

        // --- Store the successfully used initial config ---
        currentChatConfig = { ...initialChatOptions };
        currentComplianceConfig = { ...initialComplianceOptions };


        // --- Event Listeners for testing the SDK ---
        logOutput('Setting up event listeners for AnimusClient...');

        // --- Unified Message Event Listeners ---
        // All message types (regular, auto-turn, follow-up) use the same events
        
        // --- Image Generation Events ---
        client.on('imageGenerationStart', (data) => {
            logOutput(`🎨 Image generation started: "${data.prompt}"`);
            
            // Add a visual indicator in the chat
            const imageIndicator = addMessage('assistant', 'Generating image...');
            imageIndicator.dataset.imagePrompt = data.prompt;
            imageIndicator.dataset.imageIndicator = 'true';
        });
        
        client.on('imageGenerationComplete', (data) => {
            logOutput(`✅ Image generation completed: "${data.prompt}" -> ${data.imageUrl}`);
            
            // Find and remove the image generation indicator
            const indicators = chatWindow.querySelectorAll('[data-image-indicator="true"]');
            indicators.forEach(indicator => {
                if (indicator.dataset.imagePrompt === data.prompt) {
                    indicator.remove();
                }
            });
            
            // Create an image element and add it to the chat (UI only - SDK handles history)
            const imageMessage = addMessage('assistant', '');
            const imgElement = document.createElement('img');
            imgElement.src = data.imageUrl;
            imgElement.alt = data.prompt;
            imgElement.style.maxWidth = '100%';
            imgElement.style.height = 'auto';
            imgElement.style.borderRadius = '8px';
            imgElement.style.marginTop = '8px';
            
            // Just show the image without the textual description
            // The SDK already added the proper context to chat history for the LLM
            imageMessage.textContent = '';
            imageMessage.appendChild(imgElement);
        });
        
        client.on('imageGenerationError', (data) => {
            logOutput(`❌ Image generation failed: "${data.prompt}" - ${data.error}`, true);
            
            // Find and remove the image generation indicator
            const indicators = chatWindow.querySelectorAll('[data-image-indicator="true"]');
            indicators.forEach(indicator => {
                if (indicator.dataset.imagePrompt === data.prompt) {
                    indicator.remove();
                }
            });
            
            // Add error message to chat
            addMessage('assistant', `❌ Failed to generate image: ${data.error}`);
        });
        
        // --- Unified Message Events ---
        client.on('messageStart', (data) => {
            logOutput(`📤 ${data.messageType} message started (${data.conversationId})`);
            logOutput(`   Content: "${data.content}"`);
            
            // Handle different message types
            if (data.messageType === 'auto') {
                logOutput(`🔄 Starting auto-turn ${data.turnIndex + 1}/${data.totalTurns}`);
                
                // Add a visual indicator in the chat
                const turnIndicator = addMessage('system', `🔄 Turn ${data.turnIndex + 1}/${data.totalTurns} starting...`, null, 'turn-indicator');
                turnIndicator.dataset.timestamp = Date.now().toString();
                turnIndicator.dataset.turnIndex = data.turnIndex.toString();
                
                // Add a timeout to clean up stuck turn indicators (30 seconds)
                setTimeout(() => {
                    if (turnIndicator.parentNode && turnIndicator.dataset.turnIndicator === 'true') {
                        logOutput(`⚠️ Cleaning up stuck turn indicator for turn ${data.turnIndex + 1}`, true);
                        turnIndicator.remove();
                    }
                }, 30000);
            } else if (data.messageType === 'followup') {
                logOutput(`🔄 Starting follow-up request`);
                addMessage('system', '🔄 Continuing conversation...', null, 'followup-indicator');
            } else {
                logOutput(`📤 Starting regular message`);
                // Regular messages already have typing indicators from the send function
            }
        });
        
        client.on('messageTokens', (data) => {
            // This is too granular to log every token, but could be used for real-time typing animations
            // For demonstration purposes, we'll log token counts periodically
            if (data.content.length > 10) {
                logOutput(`📝 Received token: ${data.content.length} chars`);
            }
        });
        
        client.on('messageProgress', (data) => {
            logOutput(`📊 Message progress (${data.content.length} chars, complete: ${data.isComplete})`);
            // Progress updates can be used to update UI as content builds
            // This is especially useful for long responses that are built up progressively
        });
        
        client.on('messageComplete', (data) => {
            const messageType = data.messageType || 'regular';
            const contentLength = data.content ? data.content.length : 0;
            logOutput(`✅ ${messageType} message complete (${contentLength} chars)`);
            console.log(`🔍 Message data:`, data); // Debug: log the entire data object
            
            // Handle different message types
            if (messageType === 'auto') {
                logOutput(`✅ Completed auto-turn ${data.turnIndex + 1}/${data.totalTurns}`);
                
                // Remove the turn indicator and add the actual message
                removeLastTurnIndicator();
                
                // Remove the typing indicator if this is the first turn
                if (data.turnIndex === 0) {
                    removeTypingIndicator();
                }
                
                if (data.content) {
                    addMessage('assistant', data.content, data.reasoning);
                }
                
            } else if (messageType === 'followup') {
                logOutput(`✅ Completed follow-up request`);
                
                // Remove follow-up indicator and add the message
                const followupIndicators = chatWindow.querySelectorAll('.followup-indicator');
                followupIndicators.forEach(indicator => indicator.remove());
                
                if (data.content) {
                    addMessage('assistant', data.content, data.reasoning);
                }
                
            } else {
                // Regular message
                logOutput(`✅ Completed regular message`);
                
                // If the response has tool calls, handle them
                if (data.toolCalls && data.toolCalls.length > 0) {
                    logOutput(`🔧 Message includes tool calls: ${data.toolCalls.length}`);
                }
                
                // Remove typing indicator and add the message to UI
                removeTypingIndicator();
                
                if (data.content && data.content.trim()) {
                    addMessage('assistant', data.content, data.reasoning);
                }
            }
            
            // Check if all messages are complete (when totalMessages is present)
            if (data.totalMessages) {
                logOutput(`✅ All ${data.totalMessages} messages completed`);
                
                // Clean up all indicators and re-enable UI
                removeTypingIndicator();
                removeAllTurnIndicators();
                setInputEnabled(true, 'Connected - Ready to Chat');
                updateStatus('Connected - Ready to Chat');
            } else if (messageType === 'regular') {
                // For regular messages, re-enable UI immediately
                setInputEnabled(true, 'Connected - Ready to Chat');
                updateStatus('Connected - Ready to Chat');
            }
        });
        
        client.on('messageError', (data) => {
            const messageType = data.messageType || 'regular';
            logOutput(`❌ ${messageType} message error: ${data.error}`, true);
            
            // Handle different error types
            if (messageType === 'auto' && data.error.includes('Canceled')) {
                logOutput(`❌ Canceled auto-turn messages`);
                
                // Remove any turn indicators
                removeAllTurnIndicators();
                addMessage('system', `❌ Canceled pending auto-turn messages`, null, 'turn-canceled');
                
                // Re-enable input since user interrupted
                setInputEnabled(true, 'Connected - Ready to Chat');
                updateStatus('Connected - Ready to Chat');
            } else {
                // Regular error handling
                updateStatus(`Error: ${data.error}`, true);
                
                // Remove typing indicator and re-enable input
                removeTypingIndicator();
                setInputEnabled(true, 'Connected - Ready to Chat');
            }
        });


        // --- Send Logic - Using fully event-driven approach ---
        let httpAssistantMessageElement = null; // Track the HTTP assistant message bubble
        let typingIndicatorElement = null; // Track the typing indicator bubble

        // Function to remove the typing indicator
        function removeTypingIndicator() {
            if (typingIndicatorElement) {
                typingIndicatorElement.remove();
                typingIndicatorElement = null;
            }
        }

        // Changed to standard function from async
        function sendMessage() {
            httpAssistantMessageElement = null; // Reset HTTP tracker
            const userMessage = messageInput.value.trim();
            if (!userMessage || sendButton.disabled) return;

            // Clean up any existing turn indicators when sending a new message
            removeAllTurnIndicators();
            removeTypingIndicator();

            logOutput(`Sending: "${userMessage}"`);
            
            // Only add to UI if it's not a continuation message
            if (userMessage !== '[CONTINUE]') {
                addMessageToChat('user', userMessage); // Uses Tailwind classes
            } else {
                logOutput(`📤 Sending continuation request (not displayed in UI)`);
            }
            messageInput.value = '';
            messageInput.style.height = 'auto';
            messageInput.focus();

            setInputEnabled(false, 'Sending to AI...');
            updateStatus('Sending to AI...');

            // Add typing indicator
            typingIndicatorElement = addMessageToChat('assistant', 'Assistant is typing');
            typingIndicatorElement.classList.remove('bg-gray-200', 'text-gray-800');
            typingIndicatorElement.classList.add('bg-gray-100', 'text-gray-500', 'italic');

            // Determine if reasoning and image generation are enabled based on checkboxes
            const isReasoningEnabled = reasoningInput.checked;
            const isImageGenerationEnabled = imageGenerationInput.checked;
            
            // Prepare message options - Always use stream: true for event-driven approach
            const messageOptions = {
                stream: false, // Always use streaming for event-driven approach
                reasoning: isReasoningEnabled,
                check_image_generation: isImageGenerationEnabled // Based on checkbox
            };
            
            // Add a simple monkey patch to verify what's in the actual API payload
            if (!window.__originalRequest && client.requestUtil && client.requestUtil.request) {
                console.log("Adding requestUtil monitor");
                window.__originalRequest = client.requestUtil.request;
                client.requestUtil.request = function(...args) {
                    if (args.length > 2 && args[2]) {
                        console.log("🔍 FINAL API REQUEST:", JSON.stringify(args[2], null, 2));
                    }
                    return window.__originalRequest.apply(this, args);
                };
            }
            
            // Send the message using the event-driven approach
            try {
                // Call send with the event-driven approach
                logOutput("Sending message with options:", messageOptions);
                
                // Send message - responses will come through events
                client.chat.send(userMessage, messageOptions);
                
                // The typing indicator is already added and will be replaced 
                // when messageComplete event fires
                logOutput("Message sent - responses will arrive via events");
                updateStatus('AI is responding...');
                
                // Note: Input will be re-enabled in the messageComplete event handler
            } catch (error) {
                // Handle any synchronous errors during sending
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

        // Note: Connection is now manual
        logOutput('SDK Initialized.');

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

// --- Dynamic Chat Configuration Update Handler ---
function updateChatConfig() {
    if (!client) {
        console.warn("Client not initialized, cannot update chat config");
        return;
    }
    
    try {
        // Create conversational turns configuration from form values
        const conversationalTurnsConfig = {
            enabled: autoTurnInput.checked,
            splitProbability: parseFloat(splitProbabilityInput.value) || 1.0,
            shortSentenceThreshold: parseInt(shortSentenceThresholdInput.value, 10) || 30,
            baseTypingSpeed: parseInt(baseTypingSpeedInput.value, 10) || 45,
            speedVariation: parseFloat(speedVariationInput.value) || 0.2,
            minDelay: parseInt(minDelayInput.value, 10) || 500,
            maxDelay: parseInt(maxDelayInput.value, 10) || 3000
        };

        // Create updated chat configuration from form values
        const updatedChatConfig = {
            model: 'animafmngvy7-xavier-r1', // Keep model the same
            systemMessage: systemPromptInput.value,
            historySize: parseInt(historySizeInput.value, 10) || 30,
            temperature: parseFloat(temperatureInput.value) || 0.7,
            stream: streamInput.checked,
            max_tokens: parseInt(maxTokensInput.value, 10) || 1024,
            reasoning: reasoningInput.checked,
            // Use object configuration for autoTurn to include detailed settings
            autoTurn: autoTurnInput.checked ? conversationalTurnsConfig : false
        };

        // Parse tools if needed
        try {
            const toolsJson = toolsInput.value.trim();
            if (toolsJson) {
                const parsedTools = JSON.parse(toolsJson);
                if (Array.isArray(parsedTools)) {
                    updatedChatConfig.tools = parsedTools;
                }
            }
        } catch (e) {
            console.warn(`Error parsing tools JSON: ${e.message}. Tools not updated.`);
        }

        // Update the compliance config
        const updatedComplianceConfig = {
            enabled: complianceInput.checked
        };

        // Update client config
        if (client.updateChatConfig) {
            client.updateChatConfig(updatedChatConfig);
            currentChatConfig = { ...updatedChatConfig };
            console.log("Chat configuration dynamically updated:", currentChatConfig);
        } else {
            console.warn("updateChatConfig method not available on client");
        }
        
        // Update compliance separately if necessary
        if (client.updateComplianceConfig) {
            client.updateComplianceConfig(updatedComplianceConfig);
            currentComplianceConfig = { ...updatedComplianceConfig };
        } else {
            console.warn("updateComplianceConfig method not available on client");
        }
        
    } catch (error) {
        console.error("Failed to update chat configuration:", error);
    }
}

// Toggle functionality for conversational turns settings
function setupToggleConversationalTurnsSettings() {
    if (toggleTurnsSettingsButton && turnsSettingsContent && toggleTurnsText) {
        toggleTurnsSettingsButton.addEventListener('click', () => {
            const isHidden = turnsSettingsContent.classList.contains('hidden');
            
            if (isHidden) {
                turnsSettingsContent.classList.remove('hidden');
                toggleTurnsText.textContent = 'Hide';
            } else {
                turnsSettingsContent.classList.add('hidden');
                toggleTurnsText.textContent = 'Show';
            }
        });
    }
}

// Call the initialization function when the script loads
initializeAndTest();
setupToggleConversationalTurnsSettings();

// After initialization, add event listeners to form fields to update config dynamically
// Wait for DOM to be fully loaded and client to be initialized
document.addEventListener('DOMContentLoaded', () => {
    // We'll add a small delay to ensure the client is initialized
    setTimeout(() => {
        if (!client) {
            console.warn("Client not initialized, cannot set up dynamic config updates");
            return;
        }

        // Add change event listeners to all config inputs
        [
            systemPromptInput,
            historySizeInput,
            maxTokensInput,
            temperatureInput,
            streamInput,
            complianceInput,
            reasoningInput,
            imageGenerationInput,
            autoTurnInput, // Include auto turn checkbox
            toolsInput,
            // Conversational turns advanced settings
            splitProbabilityInput,
            shortSentenceThresholdInput,
            baseTypingSpeedInput,
            speedVariationInput,
            minDelayInput,
            maxDelayInput
        ].forEach(input => {
            if (input) {
                const eventType = input.type === 'checkbox' ? 'change' : 'input';
                input.addEventListener(eventType, updateChatConfig);
            }
        });

        console.log("Dynamic configuration update handlers attached to form fields");
    }, 500); // 500ms delay
});