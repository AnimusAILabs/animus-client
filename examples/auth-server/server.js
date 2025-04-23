require('dotenv').config(); // Load .env file variables
const express = require('express');
const cors = require('cors');
const axios = require('axios');
 
const app = express();
const port = process.env.PORT || 3001;
 
// --- Configuration from Environment Variables ---
const animusApiKey = process.env.ANIMUS_API_KEY;
const animusAuthUrl = process.env.ANIMUS_AUTH_URL || 'https://api.animusai.co/auth/generate-token';
 
if (!animusApiKey) {
  console.error('FATAL ERROR: ANIMUS_API_KEY must be set in the .env file.');
  process.exit(1);
}
 
// --- Middleware ---

// --- Middleware ---
app.use(cors()); // Enable CORS for all origins (adjust for production)
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// --- Routes ---

// Simple health check
app.get('/', (req, res) => {
  res.send('Auth Server is running');
});

// Token endpoint - Proxies request to the central Animus Auth Service
// Handles both GET and POST requests from the SDK
// Token endpoint - Kept as /token locally for compatibility
// Proxies request to the central Animus Auth Service (expected to be /generate-token now)
app.all('/token', async (req, res) => {
  console.log(`Received /token request from SDK (${req.method}). Proxying to central Animus Auth Service at ${animusAuthUrl}...`);

  try {
    // Use GET, assuming the central service expects GET for its /generate-token endpoint
    // If it expects POST, change axios.get to axios.post and potentially add an empty body
    const response = await axios.get(animusAuthUrl, { // animusAuthUrl should point to the central /generate-token endpoint
      headers: {
        'apikey': animusApiKey, // Send the API key needed by the central service
        'Accept': 'application/json' // Ensure we get JSON back
      }
      // Add body if central service requires POST: body: {}
    });

    // The central Animus Auth Service should now return { animus: { token: "..." }, livekit: { url: "...", token: "..." } }
    if (response.data && response.data.animus && response.data.livekit) {
      console.log('Successfully received Animus and LiveKit details from central Animus Auth Service.');
      // Return the full response object directly to the client
      res.json(response.data);
    } else {
      console.error('Central Animus Auth Service response did not contain expected animus/livekit data:', response.data);
      res.status(500).json({ error: 'Invalid response received from central Animus Auth Service' });
    }

  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    const errorStatus = error.response ? error.response.status : 500;
    console.error(`Error fetching details from central Animus Auth Service (Status: ${errorStatus}):`, errorData);
    // Proxy the error status and message if available
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data && (error.response.data.error || error.response.data.message)
                      ? (error.response.data.error || error.response.data.message)
                      : 'Internal server error while contacting central Animus Auth Service';
    res.status(errorStatus).json({ error: message });
  }
});


// --- Start Server ---
app.listen(port, () => {
  console.log(`Example Client Auth Server listening on http://localhost:${port}`);
  console.log(`Configured to use Animus Auth Service URL: ${animusAuthUrl}`);
  console.log(`Using Animus API Key: ${animusApiKey ? '**********' + animusApiKey.slice(-4) : 'NOT SET!'}`);
});