// --- Interfaces based on API Documentation ---

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string of arguments
  };
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: object; // JSON Schema object
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null; // Can be null if tool_calls are present or for tool responses
  name?: string; // Optional name for user/assistant roles
  reasoning?: string; // Optional field to store extracted <think> content
  timestamp?: string; // ISO timestamp when message was created
  tool_calls?: ToolCall[]; // For assistant messages requesting a tool call
  tool_call_id?: string; // For tool messages responding to a tool call
  compliance_violations?: string[]; // Track compliance violations for context
  // Group metadata for conversational turns
  groupId?: string; // Unique identifier for grouped messages
  messageIndex?: number; // Index within the group (0-based)
  totalInGroup?: number; // Total number of messages in the group
  groupTimestamp?: number; // Original timestamp when the group was created (for reconstruction ordering)
}

// Keep all optional fields as optional in the request interface
export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model?: string;
  tools?: Tool[];
  tool_choice?: "none" | "auto" | { type: "function"; function: { name: string } };
  temperature?: number;
  top_p?: number;
  n?: number;
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
  presence_penalty?: number;
  frequency_penalty?: number;
  best_of?: number;
  top_k?: number;
  repetition_penalty?: number;
  min_p?: number;
  length_penalty?: number;
  compliance?: boolean;
  check_image_generation?: boolean;
  autoTurn?: boolean; // Enable autoTurn feature for intelligent conversation splitting
}

// --- Response Interfaces (remain the same) ---

interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null; // Can be null if tool_calls are present
    reasoning?: string; // Reasoning content from the model
    tool_calls?: ToolCall[];
    image_prompt?: string; // Prompt for generating an image
    turns?: string[]; // Array of split conversation turns from autoTurn
    next?: boolean; // Indicates if a follow-up message is likely
  };
  finish_reason: string; // e.g., 'stop', 'length', 'tool_calls'
  compliance_violations?: string[]; // Violations specific to this choice (for n > 1)
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number; // Unix timestamp
  choices: ChatCompletionChoice[];
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  compliance_violations?: string[];
}

interface ChatCompletionChunkChoiceDelta {
  role?: 'assistant';
  content?: string | null; // Can be null
  // For streaming, tool_calls might be partial and include an index
  tool_calls?: (Partial<ToolCall> & { index: number; function?: Partial<ToolCall['function']> })[];
  reasoning?: string | null; // New field for reasoning content in chunks
  turns?: string[]; // Array of split conversation turns from autoTurn
  next?: boolean; // Indicates if a follow-up message is likely
}

interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkChoiceDelta;
  finish_reason: string | null; // Can be 'tool_calls'
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: ChatCompletionResponse['usage'] | null;
  compliance_violations?: string[] | null;
}