// examples/test-sdk/websocket-test.js

// Fetches the organization-specific JWT from the generator server
// Removed fetchLiveKitDetails - Now using SDK client

// Renamed function to reflect SDK usage
// examples/test-sdk/websocket-test.js
// Assumes livekit-client UMD build is loaded globally as LivekitClient

// Fetches the organization-specific JWT from the generator server
// Removed fetchLiveKitDetails - Now using SDK client

// Renamed function to reflect SDK usage
async function testLiveKitWebSocketWithSdk() {
  const clientAuthServerUrl = 'http://localhost:3001/token'; // URL for the SDK's AuthHandler
  let room = null; // To hold the LiveKit Room instance
  let client = null; // To hold the Animus SDK client instance

  // --- UI Elements (Optional) ---
  const outputElement = document.getElementById('result');
  function updateOutput(message, isError = false) {
      console.log(message);
      if (outputElement) {
          outputElement.textContent = message;
          if (isError) {
              outputElement.classList.add('error');
          } else {
              outputElement.classList.remove('error');
          }
      }
  }

  updateOutput('Starting LiveKit SDK connection test...');


  try {
    // Ensure the global AnimusSDK object exists
    if (typeof AnimusSDK === 'undefined' || typeof AnimusSDK.AnimusClient === 'undefined') {
        const errorMsg = 'Error: AnimusSDK or AnimusSDK.AnimusClient not found. Did the SDK load correctly?';
        updateOutput(errorMsg, true);
        return;
    }
     // Ensure the global LivekitClient object exists
     if (typeof LivekitClient === 'undefined' || typeof LivekitClient.Room === 'undefined') {
        const errorMsg = 'Error: LivekitClient or LivekitClient.Room not found. Did you include the livekit-client SDK script in index.html?';
        updateOutput(errorMsg, true);
        return;
    }


    updateOutput('Initializing AnimusClient to fetch LiveKit details...');
    // Instantiate the SDK client, providing the token provider URL
    client = new AnimusSDK.AnimusClient({
        tokenProviderUrl: clientAuthServerUrl
        // No chat/vision config needed for this test
    });

    updateOutput(`Attempting to fetch LiveKit 'observer' details via SDK client...`);
    // Use the SDK client to get LiveKit details for the 'observer' context
    const livekitDetails = await client.getLiveKitDetails('observer'); // Fetch { url, token }

    updateOutput(`LiveKit 'observer' details obtained. URL: ${livekitDetails.url}`);

    // --- LiveKit Connection using livekit-client SDK ---
    updateOutput('Creating LiveKit Room instance...');
    room = new LivekitClient.Room();

    // Setup event listeners
    room.on(LivekitClient.RoomEvent.Connected, () => {
        updateOutput('Successfully connected to LiveKit room!');
        // Test successful, disconnect after a short delay
        setTimeout(() => {
            updateOutput('Disconnecting from LiveKit room...');
            room.disconnect();
        }, 3000); // Disconnect after 3 seconds
    });

    room.on(LivekitClient.RoomEvent.Disconnected, (reason) => {
        updateOutput(`Disconnected from LiveKit room. Reason: ${reason || 'N/A'}`);
        room = null; // Clean up
    });

     room.on(LivekitClient.RoomEvent.SignalConnected, () => {
        updateOutput('LiveKit signal connection established.');
        // This is often the point where you know the initial handshake worked,
        // even before the full RoomEvent.Connected fires.
    });

    // Attempt to connect
    updateOutput(`Attempting to connect to LiveKit room: ${livekitDetails.url}`);
    await room.connect(livekitDetails.url, livekitDetails.token, {
        // Optional: Connection options
        // autoSubscribe: false // Example: Don't automatically subscribe to tracks
    });
    updateOutput('Connection attempt initiated...');


  } catch (error) {
    console.error('Failed to initiate LiveKit connection test:', error);
    let errorMsg = `Failed to initiate test: ${error.message}`;
    if (error.message && error.message.includes('connect')) {
        errorMsg += ' (Check LiveKit URL/token and server status)';
    }
    updateOutput(errorMsg, true);

    // Attempt to clean up if room was partially initialized
    if (room) {
      try {
        await room.disconnect(true); // Force disconnect
        updateOutput('Cleaned up potentially lingering room connection.');
      } catch (disconnectError) {
        console.error('Error during cleanup disconnect:', disconnectError);
      }
      room = null;
    }
  }
}

// Expose the new function name to be called from HTML
window.testLiveKitWebSocketWithSdk = testLiveKitWebSocketWithSdk;

console.log('websocket-test.js loaded. Call testLiveKitWebSocketWithSdk() to start the test.');