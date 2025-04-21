# Example Animus SDK Auth Server (Token Provider)

This directory contains a simple Node.js/Express server acting as a "Token Provider" for local testing of the Animus Javascript SDK.

**Disclaimer:** This is a basic example. Production environments require more robust security and error handling.

## Purpose

This server demonstrates securely handling `clientId` and `clientSecret` on a backend to provide access tokens to the browser SDK.

1.  Stores credentials securely (via `.env`).
2.  Provides a `/token` endpoint for the SDK.
3.  Generates a JWT using `JwtGenerator.js` based on Kong-style configuration.
4.  Returns the `accessToken` and `expiresIn` time.

This server *only* provides tokens; it does not proxy API calls.

## Setup

1.  **Navigate:** `cd examples/auth-server`
2.  **Install:** `npm install`
3.  **Configure:**
    *   Copy `.env.example` to `.env`.
    *   Edit `.env` and provide values for:
        *   `CLIENT_ID`: Your Kong consumer JWT key/Client ID (used for JWT `iss` claim).
        *   `CLIENT_SECRET`: Your Kong consumer JWT secret (used for signing the JWT).
        *   `JWT_AUDIENCE`: Target API audience (e.g., `https://api.animusai.co`).
        *   `ORG_ID`: Your Animus organization ID (for JWT `org_id` claim).
        *   `JWT_EXPIRES_IN` (Optional): JWT expiration time (default: `15m`).
        *   `PORT` (Optional): Port for this server (default: `3001`).

## Running

*   **Development:** `npm run dev` (auto-restarts)
*   **Standard:** `npm start`

The server will typically start on `http://localhost:3001`.

## Endpoint: `POST /token`

*   **Request Body (JSON):**
    ```json
    {
      "clientId": "YOUR_CLIENT_ID",
      "clientSecret": "YOUR_CLIENT_SECRET"
    }
    ```
    *(Note: This simplified example server no longer validates the incoming request body. It assumes any request to `/token` is valid and proceeds to generate a JWT using the server's configured `CLIENT_ID`, `CLIENT_SECRET`, etc.)*
*   **Success Response (200 OK):**
    ```json
    {
      "accessToken": "generated_jwt_token_string",
      "expiresIn": 900 // Expiry time in seconds
    }
    ```
*   **Error Responses:** 500 (Token Generation Error). (401 is removed as validation is skipped).

## SDK Integration

Configure the Animus SDK with the URL:

```javascript
import { AnimusClient } from 'animus-client-sdk';

const client = new AnimusClient({
  tokenProviderUrl: 'http://localhost:3001/token'
});
```

The SDK's `AuthHandler` calls this endpoint (using POST) to fetch tokens.