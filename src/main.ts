import { Plugin, TFile, Notice, WorkspaceLeaf } from "obsidian";
import { PaperProcessorSettings, DEFAULT_SETTINGS, PaperProcessorSettingTab } from "./settings";
import { OCRService } from "./services/ocr";
import { TranslatorService } from "./services/translator";
import { BlogGeneratorService } from "./services/blog-generator";
import { SlidesGeneratorService } from "./services/slides-generator";
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
      name: "OCR: Convert PDF to Markdown",
      callback: () => this.runOCR(),
    });

    // ===== Translation Commands =====
    this.addCommand({
      id: "translate-paper",
      name: "Translate: Translate paper to Korean",
      callback: () => this.runTranslation(),
    });

    this.addCommand({
      id: "translate-current-file",
      name: "Translate: Translate current file",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === "md") {
          if (!checking) {
            this.translateCurrentFile(file);
          }
          return true;
        }
        return false;
      },
    });

    // ===== Blog Generation Commands =====
    this.addCommand({
      id: "generate-blog",
      name: "Blog: Generate blog post from paper",
      callback: () => this.runBlogGeneration(),
    });

    // ===== Slides Generation Commands =====
    this.addCommand({
      id: "generate-slides",
      name: "Slides: Generate presentation slides",
      callback: () => this.runSlidesGeneration(),
    });

    // ===== Full Pipeline Command =====
    this.addCommand({
      id: "full-pipeline",
      name: "Full Pipeline: OCR → Translate → Blog → Slides",
      callback: () => this.runFullPipeline(),
    });

    // ===== Sidebar Command =====
    this.addCommand({
      id: "open-sidebar",
      name: "Open Paper Processor Sidebar",
      callback: () => this.activateSidebar(),
    });

    // Add ribbon icon - opens sidebar
    this.addRibbonIcon("file-text", "Paper Processor", () => {
      this.activateSidebar();
    });

    // Register context menu for PDF files
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "pdf") {
          menu.addItem((item) => {
            item
              .setTitle("OCR this PDF")
              .setIcon("file-text")
              .onClick(() => this.ocrFile(file));
          });
        }

        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) => {
            item
              .setTitle("Translate this file")
              .setIcon("languages")
              .onClick(() => this.translateCurrentFile(file));
          });
        }
      })
    );

    console.log("Paper Processor plugin loaded");
  }

  onunload() {
    // Detach sidebar view
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PAPER_PROCESSOR);
    console.log("Paper Processor plugin unloaded");
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

  private async runOCR() {
    if (!this.settings.mistralApiKey) {
      new Notice("Please configure Mistral API key in settings first");
      return;
    }

    new PDFPickerModal(this.app, (file) => this.ocrFile(file)).open();
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

  private async runTranslation() {
    if (!this.settings.grokApiKey) {
      new Notice("Please configure Grok API key in settings first");
      return;
    }

    new MarkdownPickerModal(this.app, this.settings.outputFolder, (file) => {
      this.translateFile(file);
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

  private async runBlogGeneration() {
    if (!this.settings.geminiApiKey) {
      new Notice("Please configure Gemini API key in settings first");
      return;
    }

    new PaperFolderPickerModal(this.app, this.settings.outputFolder, (folder) => {
      this.generateBlog(folder);
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

  // ===== Slides Generation =====

  private async runSlidesGeneration() {
    if (!this.settings.geminiApiKey) {
      new Notice("Please configure Gemini API key in settings first");
      return;
    }

    new PaperFolderPickerModal(this.app, this.settings.outputFolder, (folder) => {
      this.generateSlides(folder);
    }).open();
  }

  private async generateSlides(folder: string) {
    const progress = new ProgressModal(this.app, "Slides Generation");
    progress.open();

    const service = new SlidesGeneratorService(this.app, this.settings);
    service.setProgressCallback((p) => {
      progress.setProgress(p.percent, p.message);
    });

    const result = await service.generate(folder);

    if (result.success) {
      progress.complete(`Slides created: ${result.htmlPath}`);
    } else {
      progress.error(result.error || "Unknown error");
    }
  }

  // ===== Full Pipeline =====

  private async runFullPipeline() {
    // Check all API keys
    const missingKeys: string[] = [];
    if (!this.settings.mistralApiKey) missingKeys.push("Mistral (OCR)");
    if (!this.settings.grokApiKey) missingKeys.push("Grok (Translation)");
    if (!this.settings.geminiApiKey) missingKeys.push("Gemini (Blog/Slides)");

    if (missingKeys.length > 0) {
      new Notice(`Missing API keys: ${missingKeys.join(", ")}. Please configure in settings.`);
      return;
    }

    new PDFPickerModal(this.app, async (file) => {
      const progress = new ProgressModal(this.app, "Full Pipeline");
      progress.open();

      try {
        // Step 1: OCR
        progress.updateTitle("Step 1/4: OCR");
        const ocrService = new OCRService(this.app, this.settings);
        ocrService.setProgressCallback((p) => {
          progress.setProgress(p.percent * 0.25, `[OCR] ${p.message}`);
        });

        const ocrResult = await ocrService.processPDF(file);
        if (!ocrResult.success || !ocrResult.outputFolder) {
          progress.error(`OCR failed: ${ocrResult.error}`);
          return;
        }

        // Step 2: Translation
        progress.updateTitle("Step 2/4: Translation");
        const translatorService = new TranslatorService(this.app, this.settings);
        translatorService.setProgressCallback((p) => {
          progress.setProgress(25 + p.percent * 0.25, `[Translation] ${p.message}`);
        });

        const originalFile = this.app.vault.getAbstractFileByPath(`${ocrResult.outputFolder}/original.md`);
        if (!(originalFile instanceof TFile)) {
          progress.error("Could not find original.md after OCR");
          return;
        }

        const translateResult = await translatorService.translate(originalFile, ocrResult.outputFolder);
        if (!translateResult.success) {
          progress.error(`Translation failed: ${translateResult.error}`);
          return;
        }

        // Step 3: Blog Generation (conditional)
        if (this.settings.enableBlog) {
          progress.updateTitle("Step 3/4: Blog Generation");
          const blogService = new BlogGeneratorService(this.app, this.settings);
          blogService.setProgressCallback((p) => {
            progress.setProgress(50 + p.percent * 0.25, `[Blog] ${p.message}`);
          });

          const blogResult = await blogService.generate(ocrResult.outputFolder);
          if (!blogResult.success) {
            progress.addLog(`Blog generation warning: ${blogResult.error}`);
          }
        } else {
          progress.addLog("Blog generation skipped (disabled in settings)");
          progress.setProgress(75, "Blog generation skipped");
        }

        // Step 4: Slides Generation (conditional)
        if (this.settings.enableSlides) {
          progress.updateTitle("Step 4/4: Slides Generation");
          const slidesService = new SlidesGeneratorService(this.app, this.settings);
          slidesService.setProgressCallback((p) => {
            progress.setProgress(75 + p.percent * 0.25, `[Slides] ${p.message}`);
          });

          const slidesResult = await slidesService.generate(ocrResult.outputFolder);
          if (!slidesResult.success) {
            progress.addLog(`Slides generation warning: ${slidesResult.error}`);
          }
        } else {
          progress.addLog("Slides generation skipped (disabled in settings)");
          progress.setProgress(100, "Slides generation skipped");
        }

        progress.complete(`Full pipeline complete!\nOutput: ${ocrResult.outputFolder}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        progress.error(errorMessage);
      }
    }).open();
  }
}
