require('dotenv').config(); // Load .env file variables
const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Import axios
const JwtGenerator = require('./JwtGenerator');

const app = express();
const port = process.env.PORT || 3001; // Use port from .env or default to 3001

// --- Configuration from Environment Variables ---
// Credentials for JWT Generation (Kong/Animus specific)
const clientIdForJwt = process.env.CLIENT_ID; // Used for 'iss' claim
const clientSecretForSigning = process.env.CLIENT_SECRET; // Used as HS256 secret
const jwtAudience = process.env.JWT_AUDIENCE;
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '15m';
const orgIdForJwt = process.env.ORG_ID;
const ANIMUS_API_BASE_URL = process.env.ANIMUS_API_BASE_URL || 'https://api.animusai.co/v3'; // Animus API base URL


if (!clientSecretForSigning || !clientIdForJwt || !jwtAudience || !orgIdForJwt) {
  console.error('FATAL ERROR: CLIENT_ID, CLIENT_SECRET, JWT_AUDIENCE, and ORG_ID must be set in the .env file.');
  process.exit(1);
}

// --- Initialize JWT Generator ---
// Using CLIENT_SECRET as the signing key (HS256) and CLIENT_ID as the default issuer
const jwtGenerator = new JwtGenerator(clientSecretForSigning, {
  expiresIn: jwtExpiresIn,
  issuer: clientIdForJwt, // Set issuer based on CLIENT_ID
  algorithm: 'HS256' // Explicitly HS256
});

// --- Middleware ---
app.use(cors()); // Enable CORS for all origins (adjust for production)
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// --- Routes ---

// Simple health check
app.get('/', (req, res) => {
  res.send('Auth Server is running');
});

// Token endpoint - Simulates client_credentials flow
// Expects clientId and clientSecret in the request body
app.post('/token', (req, res) => {

  // Directly try to generate the token assuming the request is valid for this example
  console.log(`Received token request. Generating token...`);
  try {
      // Generate the JWT using the server's configured credentials
      // Use CLIENT_ID as subject ('sub') and also as issuer ('iss' set in constructor)
      // Add 'aud' and 'org_id' as additional claims
      const additionalClaims = {
        aud: jwtAudience,
        org_id: orgIdForJwt
      };
      // Pass CLIENT_ID (clientIdForJwt) as the subject for the token
      const accessToken = jwtGenerator.generateToken(clientIdForJwt, null, additionalClaims);

      // Calculate expiry in seconds
      let expiresInSeconds;
      if (typeof jwtExpiresIn === 'string') {
        const match = jwtExpiresIn.match(/^(\d+)([mh])$/);
        if (match) {
          const value = parseInt(match[1], 10);
          expiresInSeconds = match[2] === 'm' ? value * 60 : value * 60 * 60;
        } else {
          expiresInSeconds = 900; // Default to 15 minutes if parsing fails
          console.warn(`Could not parse JWT_EXPIRES_IN value "${jwtExpiresIn}", defaulting to 900 seconds.`);
        }
      } else {
        expiresInSeconds = jwtExpiresIn; // Assume it's already in seconds
      }

      console.log(`Successfully generated token with issuer: ${clientIdForJwt}`);
      res.json({
        accessToken: accessToken,
        expiresIn: expiresInSeconds // Send expiry in seconds
      });

    } catch (error) {
      console.error('Error generating token:', error);
      res.status(500).json({ error: 'Internal server error during token generation' });
    }
});

// --- Proxy Route ---
// This route forwards requests to the Animus API
app.all('/proxy/*', async (req, res) => {
  const targetPath = req.params[0]; // Get the path after /proxy/
  const targetUrl = `${ANIMUS_API_BASE_URL}/${targetPath}`;
  console.log(`Proxying request: ${req.method} ${targetUrl}`);

  try {
    // Generate a fresh token for each proxied request
    const additionalClaims = {
      aud: jwtAudience,
      org_id: orgIdForJwt
    };
    const accessToken = jwtGenerator.generateToken(clientIdForJwt, null, additionalClaims);

    // Prepare headers for the Animus API request
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': req.headers['content-type'] || 'application/json', // Forward content-type
      // Add any other headers you might need to forward
    };

    // Make the request to the Animus API using axios
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body, // Forward the request body
      headers: headers,
      responseType: 'stream' // Important for handling different response types correctly
    });

    // Forward the status code and headers from the Animus API response
    res.status(response.status);
    Object.keys(response.headers).forEach(key => {
      // Avoid setting headers that cause issues (like content-encoding if handled by axios)
      if (key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-encoding') {
         res.setHeader(key, response.headers[key]);
      }
    });

    // Pipe the response stream back to the client
    response.data.pipe(res);

  } catch (error) {
    console.error('Error proxying request:', error.message);
    if (error.response) {
      // If the error came from the target API (Animus)
      console.error('Animus API Error Status:', error.response.status);
      console.error('Animus API Error Data:', error.response.data);
      res.status(error.response.status).send(error.response.data);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from Animus API');
      res.status(504).json({ error: 'Gateway Timeout - No response from upstream server' });
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error setting up proxy request:', error.message);
      res.status(500).json({ error: 'Internal Server Error during proxy request setup' });
    }
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`Auth server listening on http://localhost:${port}`);
  console.log(`JWT Issuer (CLIENT_ID): ${clientIdForJwt}`);
  console.log(`JWT Audience: ${jwtAudience}`);
  console.log(`JWT Org ID: ${orgIdForJwt}`);
  console.log(`JWT Expiry: ${jwtExpiresIn}`);
});