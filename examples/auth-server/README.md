# Example Animus SDK Client Auth Server
 
This directory contains a simple Node.js/Express server demonstrating how a **client's backend** can interact with the central **Animus Auth Service** to obtain a JWT for the Animus Javascript SDK.
 
**Disclaimer:** This is a basic example for demonstration purposes. Production environments require robust user authentication, security measures, and comprehensive error handling. This example does *not* include user authentication logic.
 
## Purpose
 
This server simulates the role of the "Client Auth Server" described in the Animus architecture. Its primary function is to securely store the client's Animus API key and use it to request a JWT from the official Animus Auth Service.
 
1.  Stores the client's Animus API key securely (via `.env`).
2.  Provides a `/token` endpoint that the Animus SDK can call.
3.  When the `/token` endpoint is hit, this server calls the central Animus Auth Service (`https://api.animusai.co/auth/generate-token`) with the stored API key in the `apikey` header.
4.  It receives the JWT from the Animus Auth Service.
5.  It returns the received JWT (as `accessToken`) to the SDK.
 
This server acts as a secure intermediary, preventing the client's main Animus API key from being exposed in the frontend application.

## Setup

1.  **Navigate:** `cd examples/auth-server`
2.  **Install:** `npm install`
3.  **Configure:**
    *   Copy `.env.example` to `.env`.
    *   Edit `.env` and provide values for:
        *   `ANIMUS_API_KEY`: **Required.** Your organization's unique API key provided by Animus AI. This key is used by this server to authenticate with the central Animus Auth Service. **Keep this secret.**
        *   `ANIMUS_AUTH_URL` (Optional): The URL of the central Animus Auth Service. Defaults to `https://api.animusai.co/auth/generate-token`.
        *   `PORT` (Optional): Port for this example server (default: `3001`).

## Running

*   **Development:** `npm run dev` (auto-restarts)
*   **Standard:** `npm start`

The server will typically start on `http://localhost:3001`.

## Endpoint: `GET /token` (or `POST /token`)
 
*   **Method:** Can be `GET` or `POST`. The SDK might use `POST`, but this example server doesn't require a request body.
*   **Purpose:** When called by the Animus SDK, this endpoint triggers the server to fetch a JWT from the central Animus Auth Service using the configured `ANIMUS_API_KEY`.
*   **Request Body:** Not required or used by this example server. In a real application, you would likely perform user authentication here before proceeding to fetch the Animus JWT.
*   **Success Response (200 OK):**
    ```json
    {
      "accessToken": "jwt_token_string_received_from_animus_auth_service"
    }
    ```
    *(Note: The `expiresIn` field is typically included within the JWT payload itself (`exp` claim) and may not be needed separately in the response here.)*
*   **Error Responses:**
    *   `500 Internal Server Error`: If the `ANIMUS_API_KEY` is missing, or if there's an error communicating with the Animus Auth Service.
    *   `4xx/5xx` (Proxied): If the Animus Auth Service itself returns an error (e.g., invalid API key), this server might proxy that status code and error message.

## SDK Integration

Configure the Animus SDK with the URL of *this running server*:
 
```javascript
import { AnimusClient } from 'animus-client-sdk'; // Assuming this is the package name
 
const client = new AnimusClient({
  // Use the 'clientAuthServerUrl' parameter (as per updated architecture)
  clientAuthServerUrl: 'http://localhost:3001/token'
  // ... other SDK configurations
});
```
 
The SDK's internal `AuthHandler` will call this `clientAuthServerUrl` endpoint to fetch the JWT.