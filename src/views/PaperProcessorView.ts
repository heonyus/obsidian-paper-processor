import { ItemView, WorkspaceLeaf, TFile, TFolder, setIcon, Modal, Notice, App } from "obsidian";
import type PaperProcessorPlugin from "../main";
import { ArxivSearchService, ArxivPaper, ARXIV_CATEGORIES } from "../services/arxiv-search";
import { OCRService } from "../services/ocr";
import { TranslatorService } from "../services/translator";
import { BlogGeneratorService } from "../services/blog-generator";
import { getUsageTracker } from "../services/usage-tracker";
import { formatCost, formatTokens } from "../utils/pricing-table";

export const VIEW_TYPE_PAPER_PROCESSOR = "paper-processor-view";

type TabType = "search" | "process" | "papers" | "usage";

export class PaperProcessorView extends ItemView {
  plugin: PaperProcessorPlugin;
  private arxivService: ArxivSearchService;
  private currentTab: TabType = "search";
  private contentContainer: HTMLElement;

  // Search tab state
  private searchResults: ArxivPaper[] = [];
  private searchQuery = "";
  private selectedCategory = "";
  private isSearching = false;

  // Process tab state
  private selectedPdfPath: string | null = null;
  private processOptions = {
    ocr: true,
    translate: true,
    blog: false,
  };
  // Track multiple processing jobs in parallel
  private processingJobs: Map<string, {
    logs: string[];
    progressPercent: number;
    currentStep: string;
    outputFolder: string | null;
    startTime: number;
  }> = new Map();
  private processLogs: string[] = [];
  private progressLogEl: HTMLElement | null = null;
  private progressPercent = 0;
  private currentStep = "";

  constructor(leaf: WorkspaceLeaf, plugin: PaperProcessorPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.arxivService = new ArxivSearchService();
    this.currentTab = plugin.settings.sidebarDefaultTab || "search";
    this.processOptions.blog = plugin.settings.enableBlog;
  }

  getViewType(): string {
    return VIEW_TYPE_PAPER_PROCESSOR;
  }

  getDisplayText(): string {
    return "Paper processor";
  }

  getIcon(): string {
    return "file-text";
  }

  async onOpen(): Promise<void> {
    await Promise.resolve(); // Satisfy async requirement
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("paper-processor-view");

    // Tab navigation
    const tabNav = container.createEl("div", { cls: "pp-tab-nav" });
    this.renderTabs(tabNav);

    // Content container
    this.contentContainer = container.createEl("div", { cls: "pp-content" });
    this.renderCurrentTab();
  }

  async onClose(): Promise<void> {
    // Cleanup
  }

  private renderTabs(container: HTMLElement): void {
    container.empty();

    const tabs: { id: TabType; label: string; icon: string }[] = [
      { id: "search", label: "Search", icon: "search" },
      { id: "process", label: "Process", icon: "file-plus" },
      { id: "papers", label: "Papers", icon: "library" },
      { id: "usage", label: "Usage", icon: "bar-chart" },
    ];

    tabs.forEach((tab) => {
      const tabBtn = container.createEl("button", {
        cls: `pp-tab-btn ${this.currentTab === tab.id ? "active" : ""}`,
      });

      const iconSpan = tabBtn.createEl("span", { cls: "pp-tab-icon" });
      setIcon(iconSpan, tab.icon);

      tabBtn.createEl("span", { text: tab.label, cls: "pp-tab-label" });

      this.registerDomEvent(tabBtn, "click", () => {
        this.currentTab = tab.id;
        this.renderTabs(container);
        this.renderCurrentTab();
      });
    });
  }

  private renderCurrentTab(): void {
    this.contentContainer.empty();

    switch (this.currentTab) {
      case "search":
        this.renderSearchTab();
        break;
      case "process":
        this.renderProcessTab();
        break;
      case "papers":
        this.renderPapersTab();
        break;
      case "usage":
        this.renderUsageTab();
        break;
    }
  }

  // ==================== Search Tab ====================

  private renderSearchTab(): void {
    const container = this.contentContainer;

    // Search input
    const searchRow = container.createEl("div", { cls: "pp-search-row" });
    const searchInput = searchRow.createEl("input", {
      type: "text",
      placeholder: "Search arXiv (keyword or ID)...",
      cls: "pp-search-input",
      value: this.searchQuery,
    });

    const searchBtn = searchRow.createEl("button", { cls: "pp-search-btn" });
    setIcon(searchBtn, "search");

    // Category filter
    const filterRow = container.createEl("div", { cls: "pp-filter-row" });
    const categorySelect = filterRow.createEl("select", { cls: "pp-category-select" });
    ARXIV_CATEGORIES.forEach((cat) => {
      const option = categorySelect.createEl("option", {
        value: cat.id,
        text: cat.label,
      });
      if (cat.id === this.selectedCategory) {
        option.selected = true;
      }
    });

    // Event listeners
    this.registerDomEvent(searchInput, "input", (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
    });

    this.registerDomEvent(searchInput, "keypress", (e) => {
      if (e.key === "Enter") {
        void this.performSearch();
      }
    });

    this.registerDomEvent(searchBtn, "click", () => {
      void this.performSearch();
    });

    this.registerDomEvent(categorySelect, "change", (e) => {
      this.selectedCategory = (e.target as HTMLSelectElement).value;
    });

    // Results container
    const resultsContainer = container.createEl("div", { cls: "pp-results" });

    if (this.isSearching) {
      resultsContainer.createEl("div", { cls: "pp-loading", text: "Searching..." });
    } else if (this.searchResults.length === 0 && this.searchQuery) {
      resultsContainer.createEl("div", { cls: "pp-no-results", text: "No results found" });
    } else {
      this.searchResults.forEach((paper) => {
        this.renderPaperCard(resultsContainer, paper);
      });
    }
  }

  private async performSearch(): Promise<void> {
    if (!this.searchQuery.trim() || this.isSearching) return;

    this.isSearching = true;
    this.renderCurrentTab();

    const result = await this.arxivService.search(this.searchQuery, {
      category: this.selectedCategory || undefined,
      maxResults: this.plugin.settings.arxivMaxResults,
    });

    this.isSearching = false;

    if (result.success && result.papers) {
      this.searchResults = result.papers;
    } else {
      this.searchResults = [];
    }

    this.renderCurrentTab();
  }

  private renderPaperCard(container: HTMLElement, paper: ArxivPaper): void {
    const card = container.createEl("div", { cls: "pp-paper-card" });

    // Title
    card.createEl("h4", { cls: "pp-paper-title", text: paper.title });

    // Authors
    const authors = paper.authors.slice(0, 3).join(", ") + (paper.authors.length > 3 ? " et al." : "");
    card.createEl("p", { cls: "pp-paper-authors", text: authors });

    // Date and category
    const meta = card.createEl("div", { cls: "pp-paper-meta" });
    const date = new Date(paper.published).toLocaleDateString();
    meta.createEl("span", { text: date });
    meta.createEl("span", { text: paper.primaryCategory, cls: "pp-paper-category" });

    // Abstract (truncated)
    const abstract = paper.abstract.length > 200 ? paper.abstract.substring(0, 200) + "..." : paper.abstract;
    card.createEl("p", { cls: "pp-paper-abstract", text: abstract });

    // Actions
    const actions = card.createEl("div", { cls: "pp-paper-actions" });

    const importBtn = actions.createEl("button", { cls: "pp-btn pp-btn-primary", text: "Import" });
    this.registerDomEvent(importBtn, "click", () => {
      void this.importPaper(paper);
    });

    const arxivLink = actions.createEl("a", {
      cls: "pp-btn pp-btn-secondary",
      text: "Arxiv",
      href: paper.arxivUrl,
    });
    arxivLink.setAttr("target", "_blank");
  }

  private async importPaper(paper: ArxivPaper): Promise<void> {
    // Download PDF
    const result = await this.arxivService.downloadPdf(paper.arxivId);
    if (!result.success || !result.data) {
      this.showNotice(`Failed to download: ${result.error}`);
      return;
    }

    // Create folder and save PDF
    const slug = this.generateSlug(paper.title);
    const folderPath = `${this.plugin.settings.outputFolder}/${slug}`;

    // Ensure folder exists
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.app.vault.createFolder(folderPath);
    }

    // Save PDF
    const pdfPath = `${folderPath}/${slug}.pdf`;
    await this.app.vault.createBinary(pdfPath, result.data);

    // Save metadata
    const metadata = {
      title: paper.title,
      title_ko: "",
      authors: paper.authors,
      arxiv_id: paper.arxivId,
      abstract: paper.abstract,
      categories: paper.categories,
      published: paper.published,
      pdf_url: paper.pdfUrl,
      arxiv_url: paper.arxivUrl,
      slug,
      date_imported: new Date().toISOString(),
    };
    await this.app.vault.create(`${folderPath}/metadata.json`, JSON.stringify(metadata, null, 2));

    this.showNotice(`Imported: ${paper.title}`);

    // Switch to process tab with this PDF selected
    this.selectedPdfPath = pdfPath;
    this.currentTab = "process";
    this.renderCurrentTab();
  }

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .substring(0, 50);
  }

  // ==================== Process Tab ====================

  private renderProcessTab(): void {
    const container = this.contentContainer;

    // PDF selection area
    const dropZone = container.createEl("div", { cls: "pp-drop-zone" });

    if (this.selectedPdfPath) {
      dropZone.addClass("has-file");
      const fileName = this.selectedPdfPath.split("/").pop() || "Unknown";
      dropZone.createEl("div", { cls: "pp-drop-icon", text: "📄" });
      dropZone.createEl("div", { cls: "pp-drop-filename", text: fileName });
      const changeBtn = dropZone.createEl("button", { cls: "pp-btn pp-btn-small", text: "Change" });
      this.registerDomEvent(changeBtn, "click", () => {
        this.selectPdf();
      });
    } else {
      dropZone.createEl("div", { cls: "pp-drop-icon", text: "📁" });
      dropZone.createEl("div", { cls: "pp-drop-text", text: "Click to select PDF" });
    }

    this.registerDomEvent(dropZone, "click", () => {
      if (!this.selectedPdfPath) {
        this.selectPdf();
      }
    });

    // Process options
    const optionsContainer = container.createEl("div", { cls: "pp-options" });
    optionsContainer.createEl("h4", { text: "Processing options" });

    // Get language code for display
    const langMap: Record<string, string> = {
      "Korean": "KO",
      "Japanese": "JA",
      "Chinese": "ZH",
      "Spanish": "ES",
      "French": "FR",
      "German": "DE",
      "Portuguese": "PT",
      "Russian": "RU",
      "Italian": "IT",
      "Vietnamese": "VI",
    };
    const targetLang = langMap[this.plugin.settings.translationLanguage] || this.plugin.settings.translationLanguage;

    const options = [
      { key: "ocr", label: "OCR (PDF to markdown)", default: true },
      { key: "translate", label: `Translation (EN → ${targetLang})`, default: true },
      { key: "blog", label: "Blog generation", default: this.plugin.settings.enableBlog },
    ];

    options.forEach((opt) => {
      const optionRow = optionsContainer.createEl("label", { cls: "pp-option-row" });
      const checkbox = optionRow.createEl("input", { type: "checkbox" });
      checkbox.checked = this.processOptions[opt.key as keyof typeof this.processOptions];

      // OCR is always required
      if (opt.key === "ocr") {
        checkbox.disabled = true;
        checkbox.checked = true;
      }

      optionRow.createEl("span", { text: opt.label });

      this.registerDomEvent(checkbox, "change", () => {
        this.processOptions[opt.key as keyof typeof this.processOptions] = checkbox.checked;
      });
    });

    // Process button
    const isCurrentFileProcessing = this.selectedPdfPath ? this.processingJobs.has(this.selectedPdfPath) : false;
    const processBtn = container.createEl("button", {
      cls: "pp-btn pp-btn-primary pp-btn-large",
      text: isCurrentFileProcessing ? "Processing..." : "Process paper",
    });

    if (!this.selectedPdfPath || isCurrentFileProcessing) {
      processBtn.disabled = true;
    }

    this.registerDomEvent(processBtn, "click", () => {
      void this.processPaper();
    });

    // Progress area (always show when processing or has logs)
    const hasActiveJobs = this.processingJobs.size > 0;
    if (hasActiveJobs || this.processLogs.length > 0) {
      const progressArea = container.createEl("div", { cls: "pp-progress-area" });

      // Current step header
      if (this.currentStep) {
        const stepHeader = progressArea.createEl("div", { cls: "pp-current-step" });
        stepHeader.createEl("span", { cls: "pp-step-icon", text: "⏳" });
        stepHeader.createEl("span", { cls: "pp-step-text", text: this.currentStep });
      }

      // Progress bar
      const progressBarContainer = progressArea.createEl("div", { cls: "pp-progress-bar-container" });
      const progressBar = progressBarContainer.createEl("div", { cls: "pp-sidebar-progress-bar" });
      const progressFill = progressBar.createEl("div", { cls: "pp-sidebar-progress-fill" });
      progressFill.style.width = `${this.progressPercent}%`;
      progressBarContainer.createEl("span", { cls: "pp-progress-percent", text: `${this.progressPercent}%` });

      // 🔥 Real-time file open buttons (show after OCR completes)
      if (this.currentOutputFolder) {
        const fileButtonsArea = progressArea.createEl("div", { cls: "pp-file-buttons" });
        fileButtonsArea.createEl("span", { cls: "pp-file-buttons-label", text: "Open files (real-time):" });

        const buttonRow = fileButtonsArea.createEl("div", { cls: "pp-file-buttons-row" });

        const fileTypes = [
          { name: "Original", path: "original.md", icon: "📄" },
          { name: "Translation", path: "translated_raw.md", icon: "🌐" },
          { name: "Blog", path: "blog.md", icon: "📝" },
        ];

        for (const ft of fileTypes) {
          const filePath = `${this.currentOutputFolder}/${ft.path}`;
          const fileExists = !!this.app.vault.getAbstractFileByPath(filePath);

          const btn = buttonRow.createEl("button", {
            cls: `pp-btn pp-btn-small ${fileExists ? "" : "pp-btn-disabled"}`,
            text: `${ft.icon} ${ft.name}`,
          });

          if (fileExists) {
            this.registerDomEvent(btn, "click", () => {
              const file = this.app.vault.getAbstractFileByPath(filePath);
              if (file instanceof TFile) {
                void this.app.workspace.getLeaf().openFile(file);
              }
            });
          } else {
            btn.disabled = true;
            btn.title = "File not yet created";
          }
        }
      }

      // Log area
      this.progressLogEl = progressArea.createEl("div", { cls: "pp-log-area" });
      this.processLogs.forEach((log) => {
        const logItem = this.progressLogEl!.createEl("div", { cls: "pp-log-item" });
        logItem.setText(log);
      });

      // Auto scroll to bottom
      this.progressLogEl.scrollTop = this.progressLogEl.scrollHeight;

      // Clear button (only when not processing)
      if (!hasActiveJobs && this.processLogs.length > 0) {
        const clearBtn = progressArea.createEl("button", {
          cls: "pp-btn pp-btn-small pp-btn-secondary",
          text: "Clear logs"
        });
        this.registerDomEvent(clearBtn, "click", () => {
          this.processLogs = [];
          this.progressPercent = 0;
          this.currentStep = "";
          this.renderCurrentTab();
        });
      }
    }
  }

  private selectPdf(): void {
    // Get all PDF files in vault
    const pdfFiles = this.app.vault.getFiles().filter((f) => f.extension === "pdf");

    if (pdfFiles.length === 0) {
      this.showNotice("No PDF files found in vault");
      return;
    }

    // Create file picker modal
    const modal = new (class extends Modal {
      result: TFile | null = null;
      onSelect: (file: TFile) => void;

      constructor(app: App, files: TFile[], onSelect: (file: TFile) => void) {
        super(app);
        this.onSelect = onSelect;

        this.contentEl.createEl("h2", { text: "Select PDF file" });

        const list = this.contentEl.createEl("div", { cls: "pp-file-list" });
        files.forEach((file) => {
          const item = list.createEl("div", { cls: "pp-file-item", text: file.path });
          item.addEventListener("click", () => {
            this.onSelect(file);
            this.close();
          });
        });
      }
    })(this.app, pdfFiles, (file: TFile) => {
      this.selectedPdfPath = file.path;
      this.renderCurrentTab();
    });

    modal.open();
  }

  private addLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.processLogs.push(`[${timestamp}] ${message}`);

    // Update log area if it exists
    if (this.progressLogEl) {
      const logItem = this.progressLogEl.createEl("div", { cls: "pp-log-item" });
      logItem.setText(`[${timestamp}] ${message}`);
      this.progressLogEl.scrollTop = this.progressLogEl.scrollHeight;
    }
  }

  private updateProgress(percent: number, step: string): void {
    this.progressPercent = percent;
    this.currentStep = step;
    this.renderCurrentTab();
  }

  // Current output folder for file link buttons
  private currentOutputFolder: string | null = null;

  private async processPaper(): Promise<void> {
    if (!this.selectedPdfPath) return;

    // Check if this specific file is already being processed
    if (this.processingJobs.has(this.selectedPdfPath)) {
      this.showNotice("This file is already being processed");
      return;
    }

    const pdfFile = this.app.vault.getAbstractFileByPath(this.selectedPdfPath);
    if (!(pdfFile instanceof TFile)) {
      this.showNotice("PDF file not found");
      return;
    }

    const pdfPath = this.selectedPdfPath;
    const startTime = Date.now();

    // Register this job (allows parallel processing of different files)
    this.processingJobs.set(pdfPath, {
      logs: [],
      progressPercent: 0,
      currentStep: "",
      outputFolder: null,
      startTime,
    });

    // DON'T reset logs - keep existing logs from other parallel jobs
    // Only reset progress indicators for the overall view
    this.progressPercent = 0;
    this.currentStep = "";
    this.currentOutputFolder = null;

    // Create job-specific logger to tag all messages with filename
    const jobTag = pdfFile.basename.substring(0, 20) + (pdfFile.basename.length > 20 ? "..." : "");
    const jobLog = (msg: string) => this.addLog(`[${jobTag}] ${msg}`);

    // Add separator if there are existing logs from other jobs
    if (this.processLogs.length > 0) {
      this.addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    }
    jobLog(`🚀 Processing started`);
    this.renderCurrentTab();

    try {
      // ===== Step 1: OCR =====
      this.updateProgress(5, `Step 1/3: OCR - ${jobTag}`);
      jobLog("📄 Starting OCR...");

      const ocrService = new OCRService(this.app, this.plugin.settings);
      ocrService.setProgressCallback((p) => {
        jobLog(`[OCR] ${p.message}`);
        this.updateProgress(5 + p.percent * 0.3, `Step 1/3: ${p.message}`);
      });

      const ocrResult = await ocrService.processPDF(pdfFile);

      if (!ocrResult.success || !ocrResult.outputFolder) {
        jobLog(`❌ OCR failed: ${ocrResult.error}`);
        throw new Error(`OCR failed: ${ocrResult.error}`);
      }
      jobLog(`✅ OCR complete → ${ocrResult.outputFolder}`);

      // Update job's output folder
      const job = this.processingJobs.get(pdfPath);
      if (job) {
        job.outputFolder = ocrResult.outputFolder;
      }
      this.currentOutputFolder = ocrResult.outputFolder;
      this.renderCurrentTab(); // Re-render to show file buttons

      // ===== Step 2 & 3: Translation & Blog (PARALLEL) =====
      const runTranslation = this.processOptions.translate;
      const runBlog = this.processOptions.blog;

      if (runTranslation || runBlog) {
        this.updateProgress(35, `Step 2-3: Translation & Blog - ${jobTag}`);

        const tasks: Promise<void>[] = [];

        // Translation task
        if (runTranslation) {
          jobLog("🌐 [Parallel] Starting translation...");
          const translationTask = (async () => {
            const translatorService = new TranslatorService(this.app, this.plugin.settings);
            translatorService.setProgressCallback((p) => {
              const pageInfo = p.currentPage && p.totalPages ? ` (${p.currentPage}/${p.totalPages})` : "";
              jobLog(`[Trans] ${p.message}${pageInfo}`);
            });

            const originalFile = this.app.vault.getAbstractFileByPath(`${ocrResult.outputFolder}/original.md`);
            if (originalFile instanceof TFile) {
              const translateResult = await translatorService.translate(originalFile, ocrResult.outputFolder!);
              if (!translateResult.success) {
                jobLog(`⚠️ Translation warning: ${translateResult.error}`);
              } else {
                jobLog("✅ Translation complete → translated_raw.md");
              }
            }
          })();
          tasks.push(translationTask);
        }

        // Blog task (runs in parallel with translation)
        if (runBlog) {
          jobLog("📝 [Parallel] Starting blog generation...");
          const blogTask = (async () => {
            const blogService = new BlogGeneratorService(this.app, this.plugin.settings);
            blogService.setProgressCallback((p) => {
              jobLog(`[Blog] ${p.message}`);
            });

            const blogResult = await blogService.generate(ocrResult.outputFolder!);
            if (!blogResult.success) {
              jobLog(`⚠️ Blog warning: ${blogResult.error}`);
            } else {
              jobLog("✅ Blog complete → blog.md");
            }
          })();
          tasks.push(blogTask);
        }

        // Wait for all tasks to complete
        await Promise.all(tasks);
      } else {
        jobLog("⏭️ Translation & Blog skipped (disabled)");
      }

      // ===== Complete =====
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.updateProgress(100, "Complete!");
      jobLog(`🎉 All processing complete! (${elapsed}s)`);
      jobLog(`📁 Output: ${ocrResult.outputFolder}`);

      this.showNotice(`Processing complete: ${jobTag}`);
      this.selectedPdfPath = null;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      jobLog(`❌ Error: ${errorMsg}`);
      this.showNotice(`Error: ${errorMsg}`);
    } finally {
      // Remove this job from processing map
      this.processingJobs.delete(pdfPath);
      this.currentStep = "";
      this.renderCurrentTab();
    }
  }

  // ==================== Papers Tab ====================

  private renderPapersTab(): void {
    const container = this.contentContainer;

    // Filter input
    const filterRow = container.createEl("div", { cls: "pp-filter-row" });
    const filterInput = filterRow.createEl("input", {
      type: "text",
      placeholder: "Filter papers...",
      cls: "pp-filter-input",
    });

    // Papers list
    const papersList = container.createEl("div", { cls: "pp-papers-list" });

    // Get processed papers
    const papersFolder = this.app.vault.getAbstractFileByPath(this.plugin.settings.outputFolder);
    if (!(papersFolder instanceof TFolder)) {
      papersList.createEl("div", { cls: "pp-no-papers", text: "No papers folder found" });
      return;
    }

    const papers: { folder: TFolder; metadata: Record<string, unknown> | null }[] = [];

    papersFolder.children.forEach((child) => {
      if (child instanceof TFolder) {
        papers.push({ folder: child, metadata: null });
      }
    });

    if (papers.length === 0) {
      papersList.createEl("div", { cls: "pp-no-papers", text: "No processed papers yet" });
      return;
    }

    // Render papers
    papers.forEach(({ folder }) => {
      this.renderProcessedPaper(papersList, folder);
    });

    // Filter functionality
    this.registerDomEvent(filterInput, "input", (e) => {
      const filter = (e.target as HTMLInputElement).value.toLowerCase();
      papersList.querySelectorAll(".pp-processed-paper").forEach((el) => {
        const name = el.getAttribute("data-name") || "";
        (el as HTMLElement).style.display = name.includes(filter) ? "block" : "none";
      });
    });
  }

  private renderProcessedPaper(container: HTMLElement, folder: TFolder): void {
    const card = container.createEl("div", { cls: "pp-processed-paper" });
    card.setAttribute("data-name", folder.name.toLowerCase());

    // Folder name
    card.createEl("h4", { cls: "pp-paper-name", text: folder.name });

    // Check which files exist
    const files = {
      original: !!this.app.vault.getAbstractFileByPath(`${folder.path}/original.md`),
      translated: !!this.app.vault.getAbstractFileByPath(`${folder.path}/translated_raw.md`),
      blog: !!this.app.vault.getAbstractFileByPath(`${folder.path}/blog.md`),
    };

    // Status badges
    const statusRow = card.createEl("div", { cls: "pp-paper-status" });
    statusRow.createEl("span", {
      cls: `pp-status-badge ${files.original ? "success" : ""}`,
      text: "OCR",
    });
    statusRow.createEl("span", {
      cls: `pp-status-badge ${files.translated ? "success" : ""}`,
      text: "Trans",
    });
    statusRow.createEl("span", {
      cls: `pp-status-badge ${files.blog ? "success" : ""}`,
      text: "Blog",
    });

    // Actions
    const actions = card.createEl("div", { cls: "pp-paper-actions" });

    const openBtn = actions.createEl("button", { cls: "pp-btn pp-btn-small", text: "Open" });
    this.registerDomEvent(openBtn, "click", () => {
      // Open the translated file or original
      const filePath = files.translated ? `${folder.path}/translated_raw.md` : `${folder.path}/original.md`;
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        void this.app.workspace.getLeaf().openFile(file);
      }
    });
  }

  private showNotice(message: string): void {
    new Notice(message);
  }

  // ==================== Usage Tab ====================

  private renderUsageTab(): void {
    const container = this.contentContainer;
    const stats = getUsageTracker().getSessionStats();

    // Header
    container.createEl("div", { cls: "pp-usage-header" }).createEl("h3", {
      text: "API usage statistics",
      cls: "pp-usage-title",
    });

    // Total cost summary card
    const summaryCard = container.createEl("div", { cls: "pp-usage-summary-card" });
    const totalCostEl = summaryCard.createEl("div", { cls: "pp-usage-total-cost" });
    totalCostEl.createEl("span", { cls: "pp-usage-cost-label", text: "Session total" });
    totalCostEl.createEl("span", { cls: "pp-usage-cost-value", text: formatCost(stats.totalCost) });

    // Token stats row
    const tokenRow = summaryCard.createEl("div", { cls: "pp-usage-token-row" });
    const inputStat = tokenRow.createEl("div", { cls: "pp-usage-stat" });
    inputStat.createEl("span", { cls: "pp-usage-stat-label", text: "Input" });
    inputStat.createEl("span", { cls: "pp-usage-stat-value", text: formatTokens(stats.totalInputTokens) });
    const outputStat = tokenRow.createEl("div", { cls: "pp-usage-stat" });
    outputStat.createEl("span", { cls: "pp-usage-stat-label", text: "Output" });
    outputStat.createEl("span", { cls: "pp-usage-stat-value", text: formatTokens(stats.totalOutputTokens) });
    const callsStat = tokenRow.createEl("div", { cls: "pp-usage-stat" });
    callsStat.createEl("span", { cls: "pp-usage-stat-label", text: "Calls" });
    callsStat.createEl("span", { cls: "pp-usage-stat-value", text: String(stats.totalCalls) });

    // Session duration
    const duration = Math.round((Date.now() - stats.sessionStartTime) / 60000);
    summaryCard.createEl("div", { cls: "pp-usage-session-time", text: `Session: ${duration} min` });

    // Provider breakdown
    if (Object.keys(stats.byProvider).length > 0) {
      const providerSection = container.createEl("div", { cls: "pp-usage-section" });
      providerSection.createEl("h4", { text: "By provider", cls: "pp-usage-section-title" });

      const providerTable = providerSection.createEl("table", { cls: "pp-usage-table" });
      const thead = providerTable.createEl("thead");
      const headerRow = thead.createEl("tr");
      headerRow.createEl("th", { text: "Provider" });
      headerRow.createEl("th", { text: "Input" });
      headerRow.createEl("th", { text: "Output" });
      headerRow.createEl("th", { text: "Cost" });
      headerRow.createEl("th", { text: "Calls" });

      const tbody = providerTable.createEl("tbody");
      for (const [provider, data] of Object.entries(stats.byProvider)) {
        const row = tbody.createEl("tr");
        row.createEl("td", { text: provider });
        row.createEl("td", { text: formatTokens(data.input) });
        row.createEl("td", { text: formatTokens(data.output) });
        row.createEl("td", { text: formatCost(data.cost), cls: "pp-usage-cost-cell" });
        row.createEl("td", { text: String(data.calls) });
      }
    }

    // Feature breakdown
    if (Object.keys(stats.byFeature).length > 0) {
      const featureSection = container.createEl("div", { cls: "pp-usage-section" });
      featureSection.createEl("h4", { text: "By feature", cls: "pp-usage-section-title" });

      const featureCards = featureSection.createEl("div", { cls: "pp-usage-feature-cards" });

      const featureLabels: Record<string, { icon: string; label: string }> = {
        ocr: { icon: "📄", label: "OCR" },
        translation: { icon: "🌐", label: "Translation" },
        blog: { icon: "📝", label: "Blog" },
      };

      for (const [feature, data] of Object.entries(stats.byFeature)) {
        const featureInfo = featureLabels[feature] || { icon: "📊", label: feature };
        const card = featureCards.createEl("div", { cls: "pp-usage-feature-card" });

        const featureHeader = card.createEl("div", { cls: "pp-usage-feature-header" });
        featureHeader.createEl("span", { cls: "pp-usage-feature-icon", text: featureInfo.icon });
        featureHeader.createEl("span", { cls: "pp-usage-feature-name", text: featureInfo.label });

        card.createEl("div", { cls: "pp-usage-feature-cost", text: formatCost(data.cost) });

        const detailsEl = card.createEl("div", { cls: "pp-usage-feature-details" });
        detailsEl.createEl("span", { text: `${formatTokens(data.input + data.output)} tokens` });
        detailsEl.createEl("span", { text: `${data.calls} calls` });
      }
    }

    // Empty state
    if (stats.totalCalls === 0) {
      const emptyEl = container.createEl("div", { cls: "pp-usage-empty" });
      emptyEl.createEl("div", { cls: "pp-usage-empty-icon", text: "📊" });
      emptyEl.createEl("div", { cls: "pp-usage-empty-text", text: "No API usage in this session yet." });
      emptyEl.createEl("div", { cls: "pp-usage-empty-hint", text: "Process a paper to see usage statistics." });
    }

    // Reset button
    const actionsArea = container.createEl("div", { cls: "pp-usage-actions" });
    const resetBtn = actionsArea.createEl("button", {
      cls: "pp-btn pp-btn-secondary",
      text: "Reset session",
    });
    this.registerDomEvent(resetBtn, "click", () => {
      getUsageTracker().resetSession();
      this.renderCurrentTab();
      this.showNotice("Usage statistics reset");
    });

    // Auto-refresh hint
    actionsArea.createEl("span", { cls: "pp-usage-hint", text: "Statistics update in real-time" });
  }
}
