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
app.all('/token', async (req, res) => {
  console.log(`Received token request from SDK (${req.method}). Fetching JWT from Animus Auth Service...`);
 
  try {
    const response = await axios.get(animusAuthUrl, {
      headers: {
        'apikey': animusApiKey,
        'Accept': 'application/json' // Ensure we get JSON back
      }
    });
 
    // The Animus Auth Service should return { "token": "..." }
    if (response.data && response.data.token) {
      console.log('Successfully received JWT from Animus Auth Service.');
      res.json({
        accessToken: response.data.token
        // No need for expiresIn here, it's in the JWT payload
      });
    } else {
      console.error('Animus Auth Service response did not contain a token:', response.data);
      res.status(500).json({ error: 'Invalid response received from Animus Auth Service' });
    }
 
  } catch (error) {
    console.error('Error fetching token from Animus Auth Service:', error.response ? error.response.data : error.message);
    // Proxy the error status and message if available
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data && error.response.data.message
                      ? error.response.data.message
                      : 'Internal server error while contacting Animus Auth Service';
    res.status(status).json({ error: message });
  }
});


// --- Start Server ---
app.listen(port, () => {
  console.log(`Example Client Auth Server listening on http://localhost:${port}`);
  console.log(`Configured to use Animus Auth Service URL: ${animusAuthUrl}`);
  console.log(`Using Animus API Key: ${animusApiKey ? '**********' + animusApiKey.slice(-4) : 'NOT SET!'}`);
});