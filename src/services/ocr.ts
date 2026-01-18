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
      this.updateProgress("uploading", "Reading PDF file...", 10);

      // Read PDF file
      const pdfData = await this.app.vault.readBinary(pdfFile);

      this.updateProgress("processing", "Sending to Mistral OCR...", 30);

      // Create client and process
      const client = new MistralOCRClient(this.settings.mistralApiKey);
      const result = await client.processDocument(pdfData);

      if (!result.success || !result.data) {
        return {
          success: false,
          error: result.error || "OCR processing failed",
        };
      }

      this.updateProgress("extracting", "Extracting content...", 60);

      // Generate slug from filename
      const slug = this.generateSlug(pdfFile.basename);
      const outputFolderPath = `${this.settings.outputFolder}/${slug}`;

      // Ensure output folder exists
      await this.ensureFolder(outputFolderPath);

      this.updateProgress("saving", "Saving markdown and images...", 80);

      // Save markdown
      const markdownPath = `${outputFolderPath}/original.md`;
      await this.app.vault.create(markdownPath, result.data.markdown);

      // Save images
      const savedImages: Array<{ id: string; path: string }> = [];
      if (result.data.images && result.data.images.length > 0) {
        const imagesFolder = `${outputFolderPath}/images`;
        await this.ensureFolder(imagesFolder);

        for (const img of result.data.images) {
          if (img.data) {
            const imgPath = `${imagesFolder}/${img.id}.png`;
            const imgBuffer = this.base64ToArrayBuffer(img.data);
            await this.app.vault.createBinary(imgPath, imgBuffer);
            savedImages.push({ id: img.id, path: imgPath });
          }
        }
      }

      // Save metadata
      const metadata = {
        title: pdfFile.basename,
        slug,
        source_file: pdfFile.path,
        date_processed: new Date().toISOString(),
        images_count: savedImages.length,
      };
      await this.app.vault.create(
        `${outputFolderPath}/metadata.json`,
        JSON.stringify(metadata, null, 2)
      );

      this.updateProgress("complete", "OCR complete!", 100);
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
   * Convert base64 string to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
