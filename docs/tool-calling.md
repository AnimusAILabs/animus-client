# Tool Calling with Animus SDK

Tool calling allows you to define custom functions that the language model can invoke to interact with external systems or perform specific actions. This enables more dynamic and capable applications by extending the model's abilities beyond text generation.

## Overview

When you provide a list of tools to the model along with a user's query, the model can choose to:
1.  Respond directly to the user.
2.  Request one or more tool calls by sending a message with a `tool_calls` array.

If the model requests tool calls, your application should:
1.  Execute the specified function(s) with the arguments provided by the model.
2.  Send the results of these executions back to the model in a subsequent message with `role: 'tool'`.
3.  The model will then use these results to formulate its final response to the user.

## Defining Tools

Tools are defined as an array of `Tool` objects. Currently, only `function` type tools are supported.

**`Tool` Interface:**
```typescript
interface Tool {
  type: "function";
  function: {
    name: string;        // The name of the function to be called.
    description?: string; // An optional description of what the function does.
    parameters: object;  // A JSON Schema object describing the parameters the function accepts.
  };
}
```

**Example Tool Definition:**
```javascript
const tools = [
  {
    type: "function",
    function: {
      name: "get_current_weather",
      description: "Get the current weather in a given location",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The city and state, e.g. San Francisco, CA"
          },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"]
          }
        },
        required: ["location"]
      }
    }
  }
];
```

## Providing Tools to the Model

You can provide tools in two ways:

1.  **Default Tools via `AnimusChatOptions`**: When initializing `AnimusClient`, you can set a default list of tools that will be available for all chat sessions using that client instance, unless overridden.
    ```javascript
    // In your AnimusClient initialization
    const client = new AnimusSDK.AnimusClient({
      tokenProviderUrl: 'YOUR_TOKEN_PROVIDER_URL',
      chat: {
        model: 'YOUR_CHAT_MODEL',
        systemMessage: 'Your system prompt.',
        tools: tools // Default tools array
      }
    });
    ```

2.  **Per-Request via `ChatCompletionRequest`**: You can specify tools for a particular chat completion call. These will override any default tools for that specific request.
    ```javascript
    // When making a chat completion call
    const response = await client.chat.completions({
      messages: [{ role: 'user', content: "What's the weather in Boston?" }],
      tools: specificToolsForThisCall // Tools specific to this request
    });
    ```
    If tools are provided (either in config or request), `tool_choice` will default to `"auto"`, meaning the model can decide whether to call a function or generate a message. You can also set `tool_choice: "none"` in the `ChatCompletionRequest` to prevent tool usage for a specific call, even if tools are available.

## Handling Assistant Tool Call Requests

If the model decides to call one or more tools, the assistant's message in the `ChatCompletionResponse` (or the final accumulated message from a stream) will look like this:

**`ChatMessage` (Assistant's response):**
```typescript
{
  role: 'assistant',
  content: null, // Typically null when tool_calls are present
  tool_calls: [
    {
      id: "call_abc123", // A unique ID for this tool call
      type: "function",
      function: {
        name: "get_current_weather",
        arguments: "{\"location\": \"Boston, MA\", \"unit\": \"fahrenheit\"}" // Arguments as a JSON string
      }
    }
    // Potentially more tool calls
  ],
  // finish_reason will be 'tool_calls'
}
```
The `finish_reason` for the choice will be `"tool_calls"`.

## Sending Tool Execution Results

After your application executes the function(s) specified in `tool_calls`, you must send the results back to the model. For each tool call, you'll send a new message with `role: 'tool'`:

**`ChatMessage` (Tool response):**
```typescript
{
  role: 'tool',
  tool_call_id: "call_abc123", // The ID from the assistant's tool_call
  content: "{\"temperature\": \"72\", \"unit\": \"fahrenheit\", \"description\": \"Sunny\"}" // The result of the function execution, as a string (often JSON)
}
```

You would then make another call to `client.chat.completions()` including this `tool` message (along with the preceding conversation history) to get the model's final response to the user.

## Example Workflow (Conceptual)

```javascript
// 1. Initial request with tools
const initialMessages = [{ role: 'user', content: "What's the weather in Boston?" }];
const tools = [ /* ... your tool definitions ... */ ];

let response = await client.chat.completions({
  messages: initialMessages,
  tools: tools
});

let assistantMessage = response.choices[0].message;
let conversationHistory = [...initialMessages, assistantMessage];

// 2. Check for tool calls and process them
if (assistantMessage.tool_calls) {
  const toolMessages = [];
  for (const toolCall of assistantMessage.tool_calls) {
    if (toolCall.function.name === "get_current_weather") {
      // Execute your function
      const functionArgs = JSON.parse(toolCall.function.arguments);
      const functionResponse = await get_current_weather(functionArgs.location, functionArgs.unit); // Your actual function

      toolMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(functionResponse)
      });
    }
  }

  // 3. Send tool responses back to the model
  conversationHistory.push(...toolMessages);
  response = await client.chat.completions({
    messages: conversationHistory,
    tools: tools // It's good practice to send tools again
  });
  assistantMessage = response.choices[0].message;
}

// 4. assistantMessage now contains the final response to the user
console.log("Final Assistant Response:", assistantMessage.content);
```

This feature significantly enhances the interactivity and capability of your AI applications built with the Animus SDK.