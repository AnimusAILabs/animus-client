// examples/test-sdk/websocket-test.js

// Fetches the organization-specific JWT from the generator server
async function fetchOrgJwtToken(generatorUrl) {
  try {
    const response = await fetch(generatorUrl, {
      // Use POST, as the SDK might, and our example server handles both GET/POST
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        // 'Content-Type': 'application/json' // Not strictly needed if body is empty
      },
      // Body is not required by our example /token endpoint, but send empty for POST convention
      body: JSON.stringify({})
    });

    if (!response.ok) {
      const errorText = await response.text(); // Get error details if possible
      throw new Error(`Failed to fetch org token: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    // The example auth server returns { "accessToken": "..." }
    if (!data.accessToken) {
        throw new Error('Access token not found in response from client auth server.');
    }
    console.log('Successfully fetched JWT access token.');
    return data.accessToken;
  } catch (error) {
    console.error('Error fetching JWT token:', error);
    throw error; // Re-throw to prevent connection attempt without token
  }
}

async function testWebSocketWithJwt() {
  const clientAuthServerUrl = 'http://localhost:3001/token'; // URL of our example client auth server
  // --- IMPORTANT: Replace with the actual Animus Realtime WebSocket endpoint ---
  const wsUrlBase = 'wss://api.animusai.co/orpheus/ws/audio'; // Use wss:// for secure connection
  let websocket = null;

  // --- UI Elements (Optional) ---
  const outputElement = document.getElementById('result');
  if (outputElement) {
      outputElement.textContent = 'Starting WebSocket test... Check console for details.';
      outputElement.classList.remove('error');
  } else {
      console.log('Starting WebSocket test... Check console for details.');
  }


  try {
    console.log(`Attempting to fetch JWT access token from ${clientAuthServerUrl}...`);
    const accessToken = await fetchOrgJwtToken(clientAuthServerUrl);

    // Append the fetched token as a query parameter named 'token'
    const wsUrlWithToken = `${wsUrlBase}?token=${encodeURIComponent(accessToken)}`;
    console.log(`Attempting to connect to WebSocket: ${wsUrlBase} (token will be sent in query)`);

    websocket = new WebSocket(wsUrlWithToken);

    websocket.onopen = (event) => {
      console.log('WebSocket connection opened:', event);
      if (outputElement) outputElement.textContent = 'WebSocket connection opened. Sending config...';


      // Send configuration message (similar to Python example)
      const configPayload = {
        type: "config",
        model: "orpheus", // Example value, adjust if needed
        speed: 1.0       // Example value, adjust if needed
      };
      console.log('Sending config message:', configPayload);
      websocket.send(JSON.stringify(configPayload));

      // Example: Send a complete message after a short delay
      setTimeout(() => {
        const completeMessage = { type: "complete" };
        console.log('Sending complete message:', completeMessage);
        websocket.send(JSON.stringify(completeMessage));
         if (outputElement) outputElement.textContent = 'Sent config and complete messages. Waiting for responses...';
      }, 2000); // Send complete after 2 seconds
    };

    websocket.onmessage = (event) => {
      console.log('WebSocket message received:', event.data);
       if (outputElement) outputElement.textContent = `Received message: ${event.data}`;
      try {
        const data = JSON.parse(event.data);
        console.log('Parsed message data:', data);
        // Handle different message types if needed
        if (data.type === 'transcription') {
          console.log(`Transcription (${data.is_final ? 'Final' : 'Partial'}): ${data.text}`);
           if (outputElement) outputElement.textContent = `Transcription: ${data.text}`;
        } else if (data.error) {
           console.error('WebSocket server error:', data.error);
            if (outputElement) {
                 outputElement.textContent = `WebSocket server error: ${data.error}`;
                 outputElement.classList.add('error');
            }
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
         if (outputElement) {
             outputElement.textContent = `Failed to parse message: ${event.data}`;
             outputElement.classList.add('error');
         }
      }
    };

    websocket.onerror = (event) => {
      console.error('WebSocket error:', event);
       if (outputElement) {
           outputElement.textContent = 'WebSocket error occurred. See console.';
           outputElement.classList.add('error');
       }
    };

    websocket.onclose = (event) => {
      console.log('WebSocket connection closed:', event.code, event.reason);
      let closeMessage = `WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason || 'N/A'}.`;
      if (event.wasClean) {
        console.log('Connection closed cleanly.');
        closeMessage += ' (Clean)';
      } else {
        console.error('Connection died unexpectedly.');
         closeMessage += ' (Unclean)';
      }
       if (outputElement) outputElement.textContent = closeMessage;
    };

  } catch (error) {
    console.error('Failed to initiate WebSocket test:', error);
     if (outputElement) {
         outputElement.textContent = `Failed to initiate test: ${error.message}`;
         outputElement.classList.add('error');
     }
    if (websocket && websocket.readyState !== WebSocket.CLOSED) {
      websocket.close();
    }
  }
}

// Expose the function to be called from HTML
window.testOrgWebSocket = testWebSocketWithJwt; // Rename function for clarity if called from HTML

console.log('websocket-test.js loaded. Call testOrgWebSocket() to start the test.');