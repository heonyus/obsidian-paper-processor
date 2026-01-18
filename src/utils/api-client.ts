import { requestUrl, RequestUrlParam, Notice } from "obsidian";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
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
      const params: RequestUrlParam = {
        url: `${this.baseUrl}${endpoint}`,
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
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
    }>("/chat/completions", body);

    if (response.success && response.data) {
      const content = response.data.choices?.[0]?.message?.content;
      if (content) {
        return { success: true, data: content };
      }
      return { success: false, error: "No content in response" };
    }

    return { success: false, error: response.error };
  }
}

/**
 * Google Gemini API client
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
          return { success: true, data: text };
        }
        return { success: false, error: "No text in response" };
      }

      return { success: false, error: `HTTP ${response.status}` };
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
      // Step 1: Upload file
      const uploadUrl = `${this.baseUrl}/files`;
      const formData = new FormData();
      const blob = new Blob([pdfData], { type: "application/pdf" });
      formData.append("file", blob, "document.pdf");
      formData.append("purpose", "ocr");

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

        return { success: true, data: { markdown, images } };
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
  new Notice(`Paper Processor Error: ${message}`, 5000);
}

export function showSuccess(message: string): void {
  new Notice(message, 3000);
}
