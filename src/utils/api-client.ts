import { requestUrl, RequestUrlParam, Notice } from "obsidian";
import type { TokenUsage } from "../types/usage";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  usage?: TokenUsage;
}

/**
 * Generic API client for making HTTP requests
 * Uses Obsidian's requestUrl for cross-platform compatibility
 */
export class ApiClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(baseUrl: string, apiKey: string, additionalHeaders?: Record<string, string>) {
    this.baseUrl = baseUrl;
    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...additionalHeaders,
    };
  }

  async post<T>(endpoint: string, body: unknown): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      console.debug(`[API] POST ${url}`);

      const params: RequestUrlParam = {
        url,
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
        throw: false,  // HTTP 에러를 예외로 던지지 않고 response로 받음
      };

      const response = await requestUrl(params);
      console.debug(`[API] Response status: ${response.status}`);

      if (response.status >= 200 && response.status < 300) {
        return { success: true, data: response.json as T };
      } else {
        console.error(`[API] Error ${response.status}:`, response.text);
        // 더 상세한 에러 정보 출력
        try {
          const errorData = JSON.parse(response.text);
          console.error(`[API] Error details:`, errorData);
        } catch {
          // JSON 파싱 실패 시 무시
        }
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.text}`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[API] Exception: ${errorMessage}`);
      // requestUrl 에러 상세 출력
      if (error && typeof error === 'object' && 'status' in error) {
        const errorWithStatus = error as { status: number | string };
        console.error(`[API] Request failed with status: ${String(errorWithStatus.status)}`);
      }
      return { success: false, error: errorMessage };
    }
  }

  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    try {
      const params: RequestUrlParam = {
        url: `${this.baseUrl}${endpoint}`,
        method: "GET",
        headers: this.headers,
      };

      const response = await requestUrl(params);

      if (response.status >= 200 && response.status < 300) {
        return { success: true, data: response.json as T };
      } else {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.text}`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Upload a file (for OCR)
   */
  async uploadFile(endpoint: string, file: ArrayBuffer, filename: string): Promise<ApiResponse<unknown>> {
    try {
      // For file uploads, we need to construct FormData manually
      // Obsidian's requestUrl supports arraybuffer body
      const params: RequestUrlParam = {
        url: `${this.baseUrl}${endpoint}`,
        method: "POST",
        headers: {
          ...this.headers,
          "Content-Type": "application/pdf",
        },
        body: file,
      };

      const response = await requestUrl(params);

      if (response.status >= 200 && response.status < 300) {
        return { success: true, data: response.json };
      } else {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.text}`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }
}

/**
 * OpenAI-compatible API client (for Grok, OpenAI, etc.)
 */
export class OpenAICompatibleClient extends ApiClient {
  private model: string;

  constructor(baseUrl: string, apiKey: string, model: string) {
    super(baseUrl, apiKey);
    this.model = model;
  }

  async chatCompletion(messages: Array<{ role: string; content: string }>, options?: {
    temperature?: number;
    maxTokens?: number;
  }): Promise<ApiResponse<string>> {
    const body = {
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 16000,
    };

    const response = await this.post<{
      choices: Array<{ message: { content: string } }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    }>("/chat/completions", body);

    if (response.success && response.data) {
      const content = response.data.choices?.[0]?.message?.content;
      if (content) {
        // Parse usage from response
        const rawUsage = response.data.usage;
        const usage: TokenUsage | undefined = rawUsage ? {
          promptTokens: rawUsage.prompt_tokens,
          completionTokens: rawUsage.completion_tokens,
          totalTokens: rawUsage.total_tokens,
        } : undefined;

        return { success: true, data: content, usage };
      }
      return { success: false, error: "No content in response" };
    }

    return { success: false, error: response.error };
  }
}

/**
 * Image data for multimodal requests
 */
export interface ImageData {
  mimeType: string;
  data: string;  // Base64 encoded image data
  name?: string;
}

/**
 * Google Gemini API client with Multimodal support
 */
export class GeminiClient {
  private apiKey: string;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta";
  private model: string;

  constructor(apiKey: string, model = "gemini-2.0-flash") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateContent(prompt: string, options?: {
    temperature?: number;
    maxOutputTokens?: number;
  }): Promise<ApiResponse<string>> {
    try {
      const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

      const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxOutputTokens ?? 8192,
        },
      };

      const response = await requestUrl({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.status >= 200 && response.status < 300) {
        const data = response.json;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          // Parse usageMetadata from Gemini response
          const usageMetadata = data?.usageMetadata;
          const usage: TokenUsage | undefined = usageMetadata ? {
            promptTokens: usageMetadata.promptTokenCount || 0,
            completionTokens: usageMetadata.candidatesTokenCount || 0,
            totalTokens: usageMetadata.totalTokenCount || 0,
          } : undefined;

          return { success: true, data: text, usage };
        }
        return { success: false, error: "No text in response" };
      }

      return { success: false, error: `HTTP ${response.status}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Generate content with images (Multimodal)
   * Sends both text and images to Gemini API for analysis
   */
  async generateContentWithImages(prompt: string, images: ImageData[], options?: {
    temperature?: number;
    maxOutputTokens?: number;
  }): Promise<ApiResponse<string>> {
    try {
      const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

      // Build parts array with text and images
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

      // Add text prompt
      parts.push({ text: prompt });

      // Add images
      for (const img of images) {
        parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data,
          },
        });
      }

      const body = {
        contents: [{ parts }],
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxOutputTokens ?? 8192,
        },
      };

      console.debug(`[Gemini] Multimodal request with ${images.length} images`);

      const response = await requestUrl({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.status >= 200 && response.status < 300) {
        const data = response.json;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          // Parse usageMetadata from Gemini response
          const usageMetadata = data?.usageMetadata;
          const usage: TokenUsage | undefined = usageMetadata ? {
            promptTokens: usageMetadata.promptTokenCount || 0,
            completionTokens: usageMetadata.candidatesTokenCount || 0,
            totalTokens: usageMetadata.totalTokenCount || 0,
          } : undefined;

          return { success: true, data: text, usage };
        }
        return { success: false, error: "No text in response" };
      }

      return { success: false, error: `HTTP ${response.status}: ${response.text}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Analyze a single image with context
   * Used for deep analysis of paper figures
   */
  async analyzeImage(image: ImageData, context: string, analysisPrompt: string): Promise<ApiResponse<string>> {
    const fullPrompt = `${analysisPrompt}\n\n## Paper Context\n${context}\n\nAnalyze this image:`;

    return this.generateContentWithImages(fullPrompt, [image], {
      temperature: 0.3,
      maxOutputTokens: 3072,
    });
  }

  /**
   * Generate content with custom parts array (text + images)
   * Used for sequential section generation with attached images
   */
  async generateContentWithParts(
    parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
    options?: {
      temperature?: number;
      maxOutputTokens?: number;
    }
  ): Promise<ApiResponse<string>> {
    try {
      const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

      const body = {
        contents: [{ parts }],
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxOutputTokens ?? 8192,
        },
      };

      const imageCount = parts.filter(p => p.inlineData).length;
      console.debug(`[Gemini] Content generation with ${imageCount} images`);

      const response = await requestUrl({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.status >= 200 && response.status < 300) {
        const data = response.json;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          // Parse usageMetadata from Gemini response
          const usageMetadata = data?.usageMetadata;
          const usage: TokenUsage | undefined = usageMetadata ? {
            promptTokens: usageMetadata.promptTokenCount || 0,
            completionTokens: usageMetadata.candidatesTokenCount || 0,
            totalTokens: usageMetadata.totalTokenCount || 0,
          } : undefined;

          return { success: true, data: text, usage };
        }
        return { success: false, error: "No text in response" };
      }

      return { success: false, error: `HTTP ${response.status}: ${response.text}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Generate content with interleaved images and text
   * Each image is placed immediately after its description for better VLM understanding
   *
   * Format: [system prompt] → [img1 label + analysis] → [img1] → [img2 label + analysis] → [img2] → ... → [paper content]
   */
  async generateContentWithInterleavedImages(
    systemPrompt: string,
    imagesWithAnalysis: Array<{ image: ImageData; label: string; analysis: string }>,
    paperContent: string,
    options?: {
      temperature?: number;
      maxOutputTokens?: number;
    }
  ): Promise<ApiResponse<string>> {
    try {
      const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

      // Build parts array with interleaved text and images
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

      // 1. System prompt
      parts.push({ text: systemPrompt });

      // 2. Interleave images with their analysis
      for (let i = 0; i < imagesWithAnalysis.length; i++) {
        const item = imagesWithAnalysis[i];

        // Add image label and analysis text
        parts.push({
          text: `\n\n=== IMAGE ${i + 1}: ${item.label} ===\n[Deep Analysis]\n${item.analysis}\n\n[The actual image is shown below - use this for detailed visual understanding]`,
        });

        // Add the actual image immediately after
        parts.push({
          inlineData: {
            mimeType: item.image.mimeType,
            data: item.image.data,
          },
        });
      }

      // 3. Paper content at the end
      parts.push({
        text: `\n\n=== PAPER CONTENT ===\n${paperContent}\n\n---\nGenerate the blog post now. Output markdown only, no explanations.`,
      });

      const body = {
        contents: [{ parts }],
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxOutputTokens ?? 8192,
        },
      };

      console.debug(`[Gemini] Interleaved multimodal request with ${imagesWithAnalysis.length} images`);

      const response = await requestUrl({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.status >= 200 && response.status < 300) {
        const data = response.json;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          // Parse usageMetadata from Gemini response
          const usageMetadata = data?.usageMetadata;
          const usage: TokenUsage | undefined = usageMetadata ? {
            promptTokens: usageMetadata.promptTokenCount || 0,
            completionTokens: usageMetadata.candidatesTokenCount || 0,
            totalTokens: usageMetadata.totalTokenCount || 0,
          } : undefined;

          return { success: true, data: text, usage };
        }
        return { success: false, error: "No text in response" };
      }

      return { success: false, error: `HTTP ${response.status}: ${response.text}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }
}

/**
 * Mistral API client for OCR
 */
export class MistralOCRClient {
  private apiKey: string;
  private baseUrl = "https://api.mistral.ai/v1";
  private model: string;

  constructor(apiKey: string, model = "mistral-ocr-latest") {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Process PDF with Mistral OCR
   * Returns markdown content and image information
   */
  async processDocument(pdfData: ArrayBuffer): Promise<ApiResponse<{
    markdown: string;
    images: Array<{ id: string; data: string }>;
  }>> {
    try {
      // Note: For file upload, we need to handle it differently
      // Obsidian's requestUrl doesn't support FormData directly
      // We'll use a different approach with base64 encoding

      const base64Pdf = this.arrayBufferToBase64(pdfData);

      // Use the OCR endpoint directly with base64
      const ocrUrl = `${this.baseUrl}/ocr`;
      const response = await requestUrl({
        url: ocrUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          document: {
            type: "document_url",
            document_url: `data:application/pdf;base64,${base64Pdf}`,
          },
          include_image_base64: true,
        }),
      });

      if (response.status >= 200 && response.status < 300) {
        const data = response.json;

        // Extract markdown and images from response
        let markdown = "";
        const images: Array<{ id: string; data: string }> = [];

        if (data.pages) {
          for (const page of data.pages) {
            if (page.markdown) {
              markdown += `<!-- Page ${page.index + 1} -->\n\n${page.markdown}\n\n`;
            }
            if (page.images) {
              for (const img of page.images) {
                images.push({
                  id: img.id || `img-${page.index}-${images.length}`,
                  data: img.image_base64 || "",
                });
              }
            }
          }
        }

        // Parse usage from Mistral OCR response
        const rawUsage = data.usage;
        const usage: TokenUsage | undefined = rawUsage ? {
          promptTokens: rawUsage.prompt_tokens || 0,
          completionTokens: rawUsage.completion_tokens || 0,
          totalTokens: rawUsage.total_tokens || 0,
        } : undefined;

        return { success: true, data: { markdown, images }, usage };
      }

      return { success: false, error: `HTTP ${response.status}: ${response.text}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}

export function showError(message: string): void {
  new Notice(`Paper processor error: ${message}`, 5000);
}

export function showSuccess(message: string): void {
  new Notice(message, 3000);
}
