import { App, TFile, TFolder, Notice } from "obsidian";
import { MistralOCRClient, showError, showSuccess } from "../utils/api-client";
import type { PaperProcessorSettings } from "../settings";

export interface OCRResult {
  success: boolean;
  markdown?: string;
  images?: Array<{ id: string; path: string }>;
  outputFolder?: string;
  error?: string;
}

export interface OCRProgress {
  stage: "uploading" | "processing" | "extracting" | "saving" | "complete";
  message: string;
  percent: number;
}

/**
 * OCR Service for converting PDF to Markdown using Mistral OCR
 */
export class OCRService {
  private app: App;
  private settings: PaperProcessorSettings;
  private onProgress?: (progress: OCRProgress) => void;

  constructor(app: App, settings: PaperProcessorSettings) {
    this.app = app;
    this.settings = settings;
  }

  /**
   * Set progress callback for UI updates
   */
  setProgressCallback(callback: (progress: OCRProgress) => void): void {
    this.onProgress = callback;
  }

  private updateProgress(stage: OCRProgress["stage"], message: string, percent: number): void {
    if (this.onProgress) {
      this.onProgress({ stage, message, percent });
    }
  }

  /**
   * Process a PDF file and convert to Markdown
   */
  async processPDF(pdfFile: TFile): Promise<OCRResult> {
    // Validate API key
    if (!this.settings.mistralApiKey) {
      return {
        success: false,
        error: "Mistral API key not configured. Please set it in plugin settings.",
      };
    }

    // Validate file type
    if (pdfFile.extension !== "pdf") {
      return {
        success: false,
        error: "Selected file is not a PDF",
      };
    }

    try {
      this.updateProgress("uploading", `📂 Source: ${pdfFile.path}`, 5);
      this.updateProgress("uploading", "📖 Reading PDF file...", 10);

      // Read PDF file
      const pdfData = await this.app.vault.readBinary(pdfFile);
      const pdfSizeKB = (pdfData.byteLength / 1024).toFixed(1);
      const pdfSizeMB = (pdfData.byteLength / (1024 * 1024)).toFixed(2);
      this.updateProgress("uploading", `📄 PDF loaded: ${pdfSizeMB}MB (${pdfSizeKB}KB)`, 15);

      this.updateProgress("processing", `🤖 Model: ${this.settings.ocrModel}`, 20);
      this.updateProgress("processing", "⏳ Sending to Mistral OCR API (this may take 1-3 minutes)...", 25);

      // Create client and process
      const client = new MistralOCRClient(this.settings.mistralApiKey, this.settings.ocrModel);
      const startTime = Date.now();
      const result = await client.processDocument(pdfData);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (!result.success || !result.data) {
        this.updateProgress("processing", `❌ OCR API Error: ${result.error}`, 30);
        return {
          success: false,
          error: result.error || "OCR processing failed",
        };
      }

      this.updateProgress("extracting", `✅ OCR complete in ${elapsed}s`, 55);

      // Count pages from markdown
      const pageCount = (result.data.markdown.match(/<!-- Page \d+ -->/g) || []).length;
      const wordCount = result.data.markdown.split(/\s+/).length;
      const imageCount = result.data.images?.length || 0;
      this.updateProgress("extracting", `📊 Extracted: ${pageCount} pages, ${wordCount.toLocaleString()} words, ${imageCount} images`, 60);

      // Generate slug from filename
      const slug = this.generateSlug(pdfFile.basename);
      const outputFolderPath = `${this.settings.outputFolder}/${slug}`;
      this.updateProgress("extracting", `📁 Output folder: ${outputFolderPath}`, 65);

      // Ensure output folder exists
      await this.ensureFolder(outputFolderPath);

      this.updateProgress("saving", "💾 Saving markdown file...", 70);

      // Fix image paths in markdown - change ![id](id) to ![id](images/id)
      let markdown = result.data.markdown;
      markdown = markdown.replace(
        /!\[([^\]]*)\]\(([^/)]+\.(png|jpg|jpeg|gif|webp))\)/gi,
        "![$1](images/$2)"
      );

      // Save markdown (overwrite if exists)
      const markdownPath = `${outputFolderPath}/original.md`;
      await this.saveFile(markdownPath, markdown);
      const markdownSizeKB = (markdown.length / 1024).toFixed(1);
      this.updateProgress("saving", `📝 Saved: original.md (${markdownSizeKB}KB)`, 75);

      // Save images
      const savedImages: Array<{ id: string; path: string }> = [];
      if (result.data.images && result.data.images.length > 0) {
        const imagesFolder = `${outputFolderPath}/images`;
        await this.ensureFolder(imagesFolder);
        this.updateProgress("saving", `🖼️ Saving ${result.data.images.length} images...`, 80);

        let savedCount = 0;
        let totalImageSize = 0;
        for (const img of result.data.images) {
          if (img.data && img.data.length > 0) {
            try {
              // Use image ID as filename - if it already has extension, keep it; otherwise add .png
              const hasExtension = /\.(png|jpg|jpeg|gif|webp)$/i.test(img.id);
              const imgFilename = hasExtension ? img.id : `${img.id}.png`;
              const imgPath = `${imagesFolder}/${imgFilename}`;
              const imgBuffer = this.base64ToArrayBuffer(img.data);
              // Skip empty buffers
              if (imgBuffer.byteLength > 0) {
                await this.saveBinaryFile(imgPath, imgBuffer);
                savedImages.push({ id: img.id, path: imgPath });
                savedCount++;
                totalImageSize += imgBuffer.byteLength;
              }
            } catch (imgError) {
              console.error(`Failed to save image ${img.id}:`, imgError);
              this.updateProgress("saving", `⚠️ Failed to save image: ${img.id}`, 85);
              // Continue with next image
            }
          }
        }
        const totalImageSizeMB = (totalImageSize / (1024 * 1024)).toFixed(2);
        this.updateProgress("saving", `✅ Saved ${savedCount} images (${totalImageSizeMB}MB total)`, 90);
      } else {
        this.updateProgress("saving", "ℹ️ No images to save", 90);
      }

      // Save metadata (overwrite if exists)
      const metadata = {
        title: pdfFile.basename,
        slug,
        source_file: pdfFile.path,
        date_processed: new Date().toISOString(),
        images_count: savedImages.length,
      };
      await this.saveFile(
        `${outputFolderPath}/metadata.json`,
        JSON.stringify(metadata, null, 2)
      );
      this.updateProgress("saving", "📋 Saved: metadata.json", 95);

      this.updateProgress("complete", `✅ OCR complete!`, 100);
      this.updateProgress("complete", `📁 Output: ${outputFolderPath}`, 100);
      this.updateProgress("complete", `📊 Summary: ${pageCount} pages, ${wordCount.toLocaleString()} words, ${savedImages.length} images`, 100);
      showSuccess(`OCR complete: ${slug}`);

      return {
        success: true,
        markdown: result.data.markdown,
        images: savedImages,
        outputFolder: outputFolderPath,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      showError(errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Generate URL-friendly slug from title
   */
  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .substring(0, 60);
  }

  /**
   * Ensure folder exists, create if not
   */
  private async ensureFolder(path: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder) {
      await this.app.vault.createFolder(path);
    }
  }

  /**
   * Base64 character lookup table
   */
  private static readonly BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  /**
   * Manual base64 decoder that never throws
   * Uses a lookup table approach instead of atob
   */
  private decodeBase64Manual(base64: string): Uint8Array {
    // Create reverse lookup
    const lookup = new Uint8Array(256);
    for (let i = 0; i < OCRService.BASE64_CHARS.length; i++) {
      lookup[OCRService.BASE64_CHARS.charCodeAt(i)] = i;
    }

    // Remove padding and calculate output length
    let paddingCount = 0;
    let len = base64.length;
    if (base64[len - 1] === "=") paddingCount++;
    if (base64[len - 2] === "=") paddingCount++;

    const outputLen = Math.floor((len * 3) / 4) - paddingCount;
    const output = new Uint8Array(outputLen);

    let outputIndex = 0;
    for (let i = 0; i < len; i += 4) {
      const a = lookup[base64.charCodeAt(i)] || 0;
      const b = lookup[base64.charCodeAt(i + 1)] || 0;
      const c = lookup[base64.charCodeAt(i + 2)] || 0;
      const d = lookup[base64.charCodeAt(i + 3)] || 0;

      if (outputIndex < outputLen) output[outputIndex++] = (a << 2) | (b >> 4);
      if (outputIndex < outputLen) output[outputIndex++] = ((b & 15) << 4) | (c >> 2);
      if (outputIndex < outputLen) output[outputIndex++] = ((c & 3) << 6) | d;
    }

    return output;
  }

  /**
   * Convert base64 string to ArrayBuffer
   * Handles data URL prefix and padding issues
   * Uses manual decoder that never throws
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    // Handle empty/null/undefined
    if (!base64 || typeof base64 !== "string" || base64.length === 0) {
      console.log("base64ToArrayBuffer: invalid input");
      return new ArrayBuffer(0);
    }

    try {
      // Strip data URL prefix if present (e.g., "data:image/png;base64,")
      let cleanBase64 = base64;
      const commaIndex = base64.indexOf(",");
      if (commaIndex !== -1) {
        cleanBase64 = base64.substring(commaIndex + 1);
      }

      // Handle empty after stripping prefix
      if (!cleanBase64 || cleanBase64.length === 0) {
        console.log("base64ToArrayBuffer: empty after stripping prefix");
        return new ArrayBuffer(0);
      }

      // Remove any whitespace, newlines, and non-base64 characters
      cleanBase64 = cleanBase64.replace(/[^A-Za-z0-9+/=]/g, "");

      // Handle empty after cleanup
      if (cleanBase64.length === 0) {
        console.log("base64ToArrayBuffer: empty after cleanup");
        return new ArrayBuffer(0);
      }

      // Fix padding
      const remainder = cleanBase64.length % 4;
      if (remainder === 1) {
        // Invalid length, try removing last char
        cleanBase64 = cleanBase64.slice(0, -1);
      } else if (remainder === 2) {
        cleanBase64 += "==";
      } else if (remainder === 3) {
        cleanBase64 += "=";
      }

      // Use manual decoder (never throws)
      const bytes = this.decodeBase64Manual(cleanBase64);

      if (bytes.length === 0) {
        console.log("base64ToArrayBuffer: decoded to empty");
        return new ArrayBuffer(0);
      }

      // Create a proper ArrayBuffer from Uint8Array
      const buffer = new ArrayBuffer(bytes.length);
      new Uint8Array(buffer).set(bytes);
      return buffer;
    } catch (error) {
      // This should never happen with manual decoder, but just in case
      console.error("base64ToArrayBuffer: unexpected error", error);
      return new ArrayBuffer(0);
    }
  }

  /**
   * Save file (create or overwrite)
   */
  private async saveFile(path: string, content: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  /**
   * Save binary file (create or overwrite)
   */
  private async saveBinaryFile(path: string, data: ArrayBuffer): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, data);
    } else {
      await this.app.vault.createBinary(path, data);
    }
  }
}
