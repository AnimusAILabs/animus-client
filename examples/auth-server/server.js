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


// --- Start Server ---
app.listen(port, () => {
  console.log(`Auth server listening on http://localhost:${port}`);
  console.log(`JWT Issuer (CLIENT_ID): ${clientIdForJwt}`);
  console.log(`JWT Audience: ${jwtAudience}`);
  console.log(`JWT Org ID: ${orgIdForJwt}`);
  console.log(`JWT Expiry: ${jwtExpiresIn}`);
});