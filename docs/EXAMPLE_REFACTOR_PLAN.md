# Plan: Refactor Frontend Example (`examples/test-sdk/`)

## 1. Goal
Refactor the `examples/test-sdk/index.html` example to use a more structured, multi-panel layout inspired by modern agent interfaces.

## 2. Target Layout (3-Row Structure)

```mermaid
graph TD
    subgraph MainApp [Animus Client Example UI]
        direction TB
        subgraph Row1 [Top Row: Media]
            direction LR
            WebcamPanel[User Webcam & Settings]
            MicPanel[User Mic Settings & Visualizer]
            AiAudioPanel[AI Audio Visualizer / Placeholder]
        end
        subgraph Row2 [Middle Row: Chat]
            ChatPanel[Chat History Interface]
        end
        subgraph Row3 [Bottom Row: Config]
            ConfigPanel[Configuration Settings (System Prompt, etc.)]
        end
    end

    style Row1 fill:#eee,stroke:#333,stroke-width:1px
    style Row2 fill:#eee,stroke:#333,stroke-width:1px
    style Row3 fill:#eee,stroke:#333,stroke-width:1px
```

*   **Row 1:** User Webcam & Settings | User Mic Settings & Visualizer | AI Audio Visualizer / Placeholder
*   **Row 2:** Chat History Interface (including status bar, chat window, input area)
*   **Row 3:** Configuration Settings (System Prompt, etc.)

## 3. Implementation Steps (Plain JavaScript First)

1.  **Refactor HTML (`index.html`):**
    *   Create main container `div`s for the three rows.
    *   Inside Row 1, create three `div`s for Webcam, Mic, and AI Audio panels. Add placeholder text/elements.
    *   Move the existing `#chat-container` content (status bar, chat window, input area) into the Row 2 `div`.
    *   Create a new `div` for Row 3 to hold configuration settings. Add placeholder elements.
2.  **Refactor CSS (Inline `<style>` or new CSS file):**
    *   Use CSS (likely Flexbox with `flex-direction: column`) to arrange the three rows vertically.
    *   Use CSS (likely Flexbox with `flex-direction: row`) to arrange the three panels within Row 1 horizontally.
    *   Adjust existing chat styles as needed.
    *   Add basic styling for the new placeholder panels (Row 1) and the Config panel (Row 3).
3.  **Refactor JavaScript (Move to `app.js`):**
    *   Create `examples/test-sdk/app.js`.
    *   Move all JS code from the inline `<script>` in `index.html` to `app.js`.
    *   Update `index.html` to load `app.js` using `<script src="app.js" defer></script>`.
    *   Update DOM element selectors in `app.js` if IDs change.
    *   Add JS logic to populate the Config panel (Row 3) with relevant info (e.g., system prompt).
4.  **Ignore `websocket-test.js`:** This file will not be integrated into the main example UI.

## 4. Future Considerations
*   Implement actual webcam/microphone functionality.
*   Implement AI audio visualization.
*   Flesh out the Configuration panel.
*   Potentially create a React version based on this structure.
*   Package components for easier reuse.