# Animus SDK Browser Test Example

This directory contains a simple HTML page (`index.html`) to test the Animus Javascript SDK in a browser environment.

## Prerequisites

1.  **Build the SDK:** Ensure you have built the main SDK project by running `npm run build` in the root directory. This creates the necessary files in the `/dist` folder, which this example references.
2.  **Run the Example Auth Server:** The example authentication server located in `/examples/auth-server` must be running.
    *   Navigate to `/examples/auth-server`.
    *   Configure its `.env` file (copy from `.env.example` and fill in details).
    *   Run `npm install`.
    *   Run `npm start` or `npm run dev`.
    The auth server typically runs on `http://localhost:3001`.

## Running the Test

1.  **Open the HTML File:** Open the `index.html` file in this directory directly in your web browser (e.g., right-click -> Open With -> Chrome/Firefox/Safari).
2.  **Open Developer Console:** Open your browser's developer console (usually by pressing F12) to see detailed logs.
3.  **Click the Button:** Click the "Run Chat Completion Test" button on the page.

## How it Works

*   The HTML page includes the UMD build of the SDK (`../../dist/animus-sdk.umd.js`).
*   The inline script instantiates `AnimusSDK.AnimusClient`.
*   It configures the client to use the running example auth server (`http://localhost:3001/token`) as the `tokenProviderUrl`.
*   When the button is clicked, it makes a sample call to `client.chat.completions`.
*   The SDK automatically calls the auth server to get a token, then makes the request to the Animus API (ensure CORS is handled appropriately if not using a proxy for the main API).
*   The result or any errors are logged to the page and the developer console.