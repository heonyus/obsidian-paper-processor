import { Plugin, TFile, Notice, WorkspaceLeaf } from "obsidian";
import { PaperProcessorSettings, DEFAULT_SETTINGS, PaperProcessorSettingTab } from "./settings";
import { OCRService } from "./services/ocr";
import { TranslatorService } from "./services/translator";
import { BlogGeneratorService } from "./services/blog-generator";
import { ProgressModal } from "./ui/progress-modal";
import { PDFPickerModal, PaperFolderPickerModal, MarkdownPickerModal } from "./ui/file-picker-modal";
import { PaperProcessorView, VIEW_TYPE_PAPER_PROCESSOR } from "./views/PaperProcessorView";

export default class PaperProcessorPlugin extends Plugin {
  settings: PaperProcessorSettings;

  async onload() {
    await this.loadSettings();

    // Add settings tab
    this.addSettingTab(new PaperProcessorSettingTab(this.app, this));

    // Register sidebar view
    this.registerView(
      VIEW_TYPE_PAPER_PROCESSOR,
      (leaf: WorkspaceLeaf) => new PaperProcessorView(leaf, this)
    );

    // ===== OCR Command =====
    this.addCommand({
      id: "ocr-pdf",
      name: "Convert PDF to Markdown (OCR)",
      callback: () => { void this.runOCR(); },
    });

    // ===== Translation Commands =====
    this.addCommand({
      id: "translate-paper",
      name: "Translate paper",
      callback: () => { void this.runTranslation(); },
    });

    this.addCommand({
      id: "translate-current-file",
      name: "Translate current file",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === "md") {
          if (!checking) {
            void this.translateCurrentFile(file);
          }
          return true;
        }
        return false;
      },
    });

    // ===== Blog Generation Commands =====
    this.addCommand({
      id: "generate-blog",
      name: "Generate blog post from paper",
      callback: () => { void this.runBlogGeneration(); },
    });

    // ===== Full Pipeline Command =====
    this.addCommand({
      id: "full-pipeline",
      name: "Run full pipeline (OCR → translate → blog)",
      callback: () => { void this.runFullPipeline(); },
    });

    // ===== Sidebar Command =====
    this.addCommand({
      id: "open-sidebar",
      name: "Open sidebar",
      callback: () => { void this.activateSidebar(); },
    });

    // Add ribbon icon - opens sidebar
    this.addRibbonIcon("file-text", "Paper Processor", () => {
      void this.activateSidebar();
    });

    // Register context menu for PDF files
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "pdf") {
          menu.addItem((item) => {
            item
              .setTitle("Convert to Markdown (OCR)")
              .setIcon("file-text")
              .onClick(() => { void this.ocrFile(file); });
          });
        }

        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) => {
            item
              .setTitle("Translate")
              .setIcon("languages")
              .onClick(() => { void this.translateCurrentFile(file); });
          });
        }
      })
    );

  }

  onunload() {
    // View cleanup is handled automatically by Obsidian
  }

  // ===== Sidebar =====

  async activateSidebar() {
    // Remove existing views
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PAPER_PROCESSOR);

    // Open in right sidebar
    const rightLeaf = await this.app.workspace.getRightLeaf(false);
    if (rightLeaf) {
      await rightLeaf.setViewState({
        type: VIEW_TYPE_PAPER_PROCESSOR,
        active: true,
      });
      this.app.workspace.revealLeaf(rightLeaf);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ===== OCR =====

  private runOCR(): void {
    if (!this.settings.mistralApiKey) {
      new Notice("Please configure Mistral API key in settings first.");
      return;
    }

    new PDFPickerModal(this.app, (file) => { void this.ocrFile(file); }).open();
  }

  private async ocrFile(file: TFile) {
    const progress = new ProgressModal(this.app, "OCR Processing");
    progress.open();

    const service = new OCRService(this.app, this.settings);
    service.setProgressCallback((p) => {
      progress.setProgress(p.percent, p.message);
    });

    const result = await service.processPDF(file);

    if (result.success) {
      progress.complete(`OCR complete! Output: ${result.outputFolder}`);
    } else {
      progress.error(result.error || "Unknown error");
    }
  }

  // ===== Translation =====

  private runTranslation(): void {
    if (!this.settings.grokApiKey) {
      new Notice("Please configure Grok API key in settings first.");
      return;
    }

    new MarkdownPickerModal(this.app, this.settings.outputFolder, (file) => {
      void this.translateFile(file);
    }).open();
  }

  private async translateCurrentFile(file: TFile) {
    if (!this.settings.grokApiKey) {
      new Notice("Please configure Grok API key in settings first");
      return;
    }

    await this.translateFile(file);
  }

  private async translateFile(file: TFile) {
    const progress = new ProgressModal(this.app, "Translation");
    progress.open();

    const service = new TranslatorService(this.app, this.settings);
    service.setProgressCallback((p) => {
      progress.setProgress(p.percent, p.message);
    });

    // Determine output folder
    const outputFolder = file.parent?.path || this.settings.outputFolder;

    const result = await service.translate(file, outputFolder);

    if (result.success) {
      progress.complete("Translation complete!");
    } else {
      progress.error(result.error || "Unknown error");
    }
  }

  // ===== Blog Generation =====

  private runBlogGeneration(): void {
    if (!this.settings.geminiApiKey) {
      new Notice("Please configure Gemini API key in settings first.");
      return;
    }

    new PaperFolderPickerModal(this.app, this.settings.outputFolder, (folder) => {
      void this.generateBlog(folder);
    }).open();
  }

  private async generateBlog(folder: string) {
    const progress = new ProgressModal(this.app, "Blog Generation");
    progress.open();

    const service = new BlogGeneratorService(this.app, this.settings);
    service.setProgressCallback((p) => {
      progress.setProgress(p.percent, p.message);
    });

    const result = await service.generate(folder);

    if (result.success) {
      progress.complete(`Blog post created: ${result.path}`);
    } else {
      progress.error(result.error || "Unknown error");
    }
  }

  // ===== Full Pipeline =====

  private runFullPipeline(): void {
    // Check all API keys
    const missingKeys: string[] = [];
    if (!this.settings.mistralApiKey) missingKeys.push("Mistral (OCR)");
    if (!this.settings.geminiApiKey) missingKeys.push("Gemini (Translation/Blog)");

    if (missingKeys.length > 0) {
      new Notice(`Missing API keys: ${missingKeys.join(", ")}. Please configure in settings.`);
      return;
    }

    new PDFPickerModal(this.app, (file) => {
      void this.executeFullPipeline(file);
    }).open();
  }

  private async executeFullPipeline(file: TFile): Promise<void> {
    const progress = new ProgressModal(this.app, "Full pipeline");
    progress.open();

    try {
      // Step 1: OCR
      progress.updateTitle("Step 1/3: OCR");
      const ocrService = new OCRService(this.app, this.settings);
      ocrService.setProgressCallback((p) => {
        progress.setProgress(p.percent * 0.33, `[OCR] ${p.message}`);
      });

      const ocrResult = await ocrService.processPDF(file);
      if (!ocrResult.success || !ocrResult.outputFolder) {
        progress.error(`OCR failed: ${ocrResult.error}`);
        return;
      }

      // Step 2: Translation
      progress.updateTitle("Step 2/3: Translation");
      const translatorService = new TranslatorService(this.app, this.settings);
      translatorService.setProgressCallback((p) => {
        progress.setProgress(33 + p.percent * 0.33, `[Translation] ${p.message}`);
      });

      const originalFile = this.app.vault.getAbstractFileByPath(`${ocrResult.outputFolder}/original.md`);
      if (!(originalFile instanceof TFile)) {
        progress.error("Could not find original.md after OCR.");
        return;
      }

      const translateResult = await translatorService.translate(originalFile, ocrResult.outputFolder);
      if (!translateResult.success) {
        progress.error(`Translation failed: ${translateResult.error}`);
        return;
      }

      // Step 3: Blog Generation (conditional)
      if (this.settings.enableBlog) {
        progress.updateTitle("Step 3/3: Blog generation");
        const blogService = new BlogGeneratorService(this.app, this.settings);
        blogService.setProgressCallback((p) => {
          progress.setProgress(66 + p.percent * 0.34, `[Blog] ${p.message}`);
        });

        const blogResult = await blogService.generate(ocrResult.outputFolder);
        if (!blogResult.success) {
          progress.addLog(`Blog generation warning: ${blogResult.error}`);
        }
      } else {
        progress.addLog("Blog generation skipped (disabled in settings).");
        progress.setProgress(100, "Blog generation skipped");
      }

      progress.complete(`Full pipeline complete!\nOutput: ${ocrResult.outputFolder}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      progress.error(errorMessage);
    }
  }
}
