# Image Modification Feature

The Animus SDK now supports both image generation and image modification through a unified API interface.

## Overview

The SDK's `generateImage` method has been enhanced to support two modes of operation:

1. **Text-to-Image Generation** - Generate new images from text descriptions
2. **Image Modification** - Modify existing images based on text prompts

## API Usage

### Text-to-Image Generation

Generate a new image from a text prompt:

```javascript
const imageUrl = await client.generateImage("A beautiful sunset over mountains");
```

### Image Modification

Modify an existing image by providing both a prompt and an input image URL:

```javascript
const modifiedImageUrl = await client.generateImage(
  "Make this a 90s cartoon style",
  "https://example.com/input-image.jpg"
);
```

## Method Signature

```typescript
generateImage(prompt: string, inputImageUrl?: string): Promise<string>
```

**Parameters:**
- `prompt` (string, required): The text prompt describing the desired image or modification
- `inputImageUrl` (string, optional): URL of the input image to modify. If not provided, generates a new image.

**Returns:**
- `Promise<string>`: The URL of the generated or modified image

## Backend Integration

The SDK automatically detects the operation mode based on the parameters:

- When only `prompt` is provided → Uses text-to-image generation model
- When both `prompt` and `inputImageUrl` are provided → Uses image modification model

The backend API request format:

### Text-to-Image Generation
```json
{
  "prompt": "A beautiful landscape with mountains and a lake"
}
```

### Image Modification
```json
{
  "prompt": "Make this a 90s cartoon style",
  "input_image": "https://example.com/input-image.jpg"
}
```

## Events

Both generation and modification operations emit the same events:

- `imageGenerationStart` - Fired when the operation begins
- `imageGenerationComplete` - Fired when the operation completes successfully
- `imageGenerationError` - Fired when the operation fails

## Error Handling

The method throws errors for invalid inputs:

- Empty or missing prompt
- Empty input image URL (when attempting modification)
- Network or API errors
- Invalid response format from the backend

## Example Usage

```javascript
// Initialize client
const client = new AnimusClient({
  tokenProviderUrl: 'https://your-auth-server.com/token',
  chat: {
    model: 'your-model',
    systemMessage: 'Your system message'
  }
});

// Generate a new image
try {
  const newImageUrl = await client.generateImage("A futuristic cityscape at night");
  console.log("Generated image:", newImageUrl);
} catch (error) {
  console.error("Generation failed:", error);
}

// Modify an existing image
try {
  const modifiedImageUrl = await client.generateImage(
    "Convert to black and white with high contrast",
    "https://example.com/original-photo.jpg"
  );
  console.log("Modified image:", modifiedImageUrl);
} catch (error) {
  console.error("Modification failed:", error);
}
```

## Integration with Chat History

Both generated and modified images are automatically added to the chat history when the chat module is available, allowing the AI to reference them in future conversations.

## Testing

The SDK includes comprehensive tests for both generation and modification scenarios. See `tests/ImageModification.test.ts` for examples of proper usage and error handling.