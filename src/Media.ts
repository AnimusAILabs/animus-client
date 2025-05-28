import { RequestUtil, ApiError } from './RequestUtil';
import type { AnimusVisionOptions } from './AnimusClient'; // Import the new type

// --- Interfaces for Media Completions (/media/completions) ---

interface MediaContentText {
  type: 'text';
  text: string;
}

interface MediaContentImageUrl {
  type: 'image_url';
  image_url: {
    /** URL of the image (http/https) or Base64 encoded data URI (data:image/...) */
    url: string;
  };
}

type MediaContent = MediaContentText | MediaContentImageUrl;

export interface MediaMessage { // Add export keyword
  role: 'system' | 'user' | 'assistant';
  content: MediaContent[] | string; // Allow string for convenience, convert internally
}

export interface MediaCompletionRequest {
  messages: MediaMessage[];
  model: string; // Required for media completions
  temperature?: number; // default: 0.1
  // Add other optional parameters if the API supports them
}

interface MediaCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
    tool_calls?: any[]; // Based on docs
  };
  logprobs?: object | null; // Based on docs
  finish_reason: string;
  stop_reason?: string | null; // Based on docs
}

export interface MediaCompletionResponse {
  id: string;
  object: string; // e.g., 'chat.completion' (based on docs example)
  created: number;
  model: string;
  choices: MediaCompletionChoice[];
  usage?: { // Optional
    prompt_tokens: number;
    total_tokens: number;
    completion_tokens: number;
  };
  prompt_logprobs?: object | null; // Based on docs
}

// --- Interfaces for Media Analysis (/media/categories) ---

type MetadataType = 'categories' | 'participants' | 'actions' | 'scene' | 'tags';

export interface MediaAnalysisRequest {
  /** URL of the image or video to analyze */
  media_url: string;
  /** Types of metadata to return (one or more filters) */
  metadata: MetadataType[];
  /** Optional: Vision model to use (if applicable, check API docs) */
  model?: string;
  /** Optional: Enables scene detection (default: false, not recommended in docs) */
  use_scenes?: boolean;
  /** Optional: Custom JSON object for webhooks */
  custom_payload?: Record<string, any>;
}

// Response for starting video analysis (POST /media/categories)
export interface MediaAnalysisJobStartResponse {
  job_id: string;
  status?: 'PROCESSING' | 'CREATED'; // Status might be returned immediately
  custom_payload?: Record<string, any>;
}

// Response for image analysis (POST /media/categories) or completed video (GET /media/categories/{job_id})
interface MediaAnalysisResultItem {
  timestamp?: string; // Only for video results
  categories?: string[];
  participants?: string[];
  actions?: string[];
  scene?: string[];
  tags?: string[];
}

export interface MediaAnalysisResultResponse {
  job_id?: string; // Present for video results
  custom_payload?: Record<string, any>; // Present for video results
  status?: 'COMPLETED' | 'FAILED'; // Present for video results
  percent_complete?: number; // Present for video results during processing
  /** For images, results are directly in metadata. For videos, they are in results array. */
  metadata?: MediaAnalysisResultItem; // For images
  results?: MediaAnalysisResultItem[]; // For videos
}

// Combined type for GET /media/categories/{job_id} response (can be processing or completed)
export type MediaAnalysisStatusResponse = MediaAnalysisJobStartResponse & MediaAnalysisResultResponse;


/**
 * Module for interacting with the Media (Vision) API endpoints.
 */
export class MediaModule {
  private requestUtil: RequestUtil;
  private config?: AnimusVisionOptions; // Store the provided vision config
  private readonly pollingIntervalMs = 5000; // Check status every 5 seconds
  private readonly pollingTimeoutMs = 300000; // Timeout after 5 minutes

  constructor(
      requestUtil: RequestUtil,
      visionOptions: AnimusVisionOptions | undefined // Receive the whole config object or undefined
  ) {
    this.requestUtil = requestUtil;
    this.config = visionOptions;
    // Note: Model checks happen within methods if needed
  }

  /**
   * Generates a response based on provided images and text using a vision-language model.
   *
   * @param request - The media completion request parameters.
   * @returns A Promise resolving to the MediaCompletionResponse.
   */
  public async completions(request: MediaCompletionRequest): Promise<MediaCompletionResponse> {
    // Ensure content is always an array of MediaContent objects
    const processedMessages = request.messages.map(msg => {
      if (typeof msg.content === 'string') {
        return { ...msg, content: [{ type: 'text', text: msg.content } as MediaContentText] };
      }
      return msg;
    });

    const payload: Record<string, any> = {
      messages: processedMessages,
      // Prioritize request model, then configured model
      model: request.model ?? this.config?.model,
    };

    // Validate model presence
    if (!payload.model) {
        throw new Error('Vision model must be specified either in the request or in the AnimusClient vision configuration.');
    }

    // Add optional parameters if provided
    if (request.temperature !== undefined) payload.temperature = request.temperature;

    return this.requestUtil.request<MediaCompletionResponse>(
      'POST',
      '/media/completions',
      payload
    );
  }

  /**
   * Analyzes an image or video and returns metadata.
   * For images, returns results directly.
   * For videos, starts an analysis job and polls for completion.
   *
   * @param request - The media analysis request parameters.
   * @returns A Promise resolving to the MediaAnalysisResultResponse.
   * @throws {ApiError} If the analysis fails or times out.
   */
  public async analyze(request: MediaAnalysisRequest): Promise<MediaAnalysisResultResponse> {
    const payload: Record<string, any> = {
        media_url: request.media_url,
        metadata: request.metadata,
    };
    // Add optional parameters if provided
    // Prioritize request model, then configured model
    payload.model = request.model ?? this.config?.model;
    // Remove model from payload if it ended up undefined (meaning neither request nor config had it)
    // Note: Some analysis endpoints might not require a model, but we prioritize consistency here.
    // If the API allows analysis without a model, this might need adjustment or explicit null/undefined in request.
    if (payload.model === undefined) {
         throw new Error('Vision model must be specified either in the request or in the AnimusClient vision configuration for analysis.');
        // Alternatively, if analysis *can* run without a model: delete payload.model;
    }
    if (request.use_scenes !== undefined) payload.use_scenes = request.use_scenes;
    if (request.custom_payload !== undefined) payload.custom_payload = request.custom_payload;


    // Make the initial request
    // The response type could be immediate results (image) or job start info (video)
    const initialResponse = await this.requestUtil.request<MediaAnalysisJobStartResponse | MediaAnalysisResultResponse>(
      'POST',
      '/media/categories',
      payload
    );

    // Check if it's a job ID response (indicating video processing)
    if (initialResponse && typeof initialResponse === 'object' && 'job_id' in initialResponse && initialResponse.job_id) {
      // It's a video job, start polling
      
      return this.pollForResult(initialResponse.job_id);
    } else {
      // Assume it's an image result (or an unexpected response)
      
      return initialResponse as MediaAnalysisResultResponse; // Cast assumes direct result
    }
  }

  /**
   * Retrieves the status and results of a media analysis job.
   *
   * @param jobId - The ID of the job to check.
   * @returns A Promise resolving to the MediaAnalysisStatusResponse.
   */
  public async getAnalysisStatus(jobId: string): Promise<MediaAnalysisStatusResponse> {
    if (!jobId) {
      throw new Error('Job ID is required to check analysis status.');
    }
    return this.requestUtil.request<MediaAnalysisStatusResponse>(
      'GET',
      `/media/categories/${jobId}`
    );
  }

  /**
   * Polls the GET /media/categories/{job_id} endpoint until completion or timeout.
   */
  private async pollForResult(jobId: string): Promise<MediaAnalysisResultResponse> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.pollingTimeoutMs) {
      try {
        const statusResponse = await this.getAnalysisStatus(jobId);

        

        if (statusResponse.status === 'COMPLETED') {
          return statusResponse; // Return the complete results
        } else if (statusResponse.status === 'FAILED') {
          throw new ApiError(`Media analysis job ${jobId} failed.`, 500, statusResponse); // Use 500 or another appropriate status
        }
        // If status is PROCESSING or CREATED, continue polling

      } catch (error) {
        // Handle errors during polling (e.g., network issues, API errors on GET)
        console.error(`Error polling job ${jobId}:`, error);
        // Decide whether to retry or fail based on the error type
        if (error instanceof ApiError && error.status >= 500) {
          // Server error, maybe retry after a delay? For now, fail.
          throw error;
        } else if (error instanceof ApiError && error.status < 500) {
           // Client error (e.g., 404 Not Found if job ID is wrong), fail immediately.
           throw error;
        }
        // For other errors (network), continue polling after delay? For now, fail.
        throw error;
      }

      // Wait before the next poll
      await new Promise(resolve => setTimeout(resolve, this.pollingIntervalMs));
    }

    // If the loop finishes, it means timeout
    throw new ApiError(`Media analysis job ${jobId} timed out after ${this.pollingTimeoutMs / 1000} seconds.`, 408); // 408 Request Timeout
  }
}