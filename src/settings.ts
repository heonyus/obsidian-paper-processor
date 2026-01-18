import { App, PluginSettingTab, Setting } from "obsidian";
import type PaperProcessorPlugin from "./main";

export interface PaperProcessorSettings {
  // API Keys
  mistralApiKey: string;
  grokApiKey: string;
  geminiApiKey: string;

  // General Settings
  outputFolder: string;

  // Model Settings
  ocrModel: string;
  translationModel: string;
  blogModel: string;
  slidesModel: string;

  // Blog Settings
  enableBlog: boolean;
  blogStyle: "technical" | "summary" | "tutorial";
  blogLanguage: "ko" | "en" | "bilingual";

  // Slides Settings
  enableSlides: boolean;
  slideCount: number;
  slideTemplate: "academic" | "minimal" | "modern";

  // arXiv Settings
  arxivDefaultCategory: string;
  arxivMaxResults: number;

  // Sidebar Settings
  sidebarDefaultTab: "search" | "process" | "papers";
}

export const DEFAULT_SETTINGS: PaperProcessorSettings = {
  // API Keys (empty by default - user must provide)
  mistralApiKey: "",
  grokApiKey: "",
  geminiApiKey: "",

  // General Settings
  outputFolder: "papers",

  // Model Settings
  ocrModel: "mistral-ocr-latest",
  translationModel: "grok-4-1-fast-non-reasoning",
  blogModel: "gemini-3-flash-preview",
  slidesModel: "gemini-3-flash-preview",

  // Blog Settings
  enableBlog: true,
  blogStyle: "technical",
  blogLanguage: "ko",

  // Slides Settings
  enableSlides: true,
  slideCount: 5,
  slideTemplate: "academic",

  // arXiv Settings
  arxivDefaultCategory: "",
  arxivMaxResults: 10,

  // Sidebar Settings
  sidebarDefaultTab: "search",
};

export class PaperProcessorSettingTab extends PluginSettingTab {
  plugin: PaperProcessorPlugin;

  constructor(app: App, plugin: PaperProcessorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ===== API Keys Section =====
    containerEl.createEl("h2", { text: "API Keys" });
    containerEl.createEl("p", {
      text: "Enter your API keys. These are stored locally and never sent anywhere except to the respective API services.",
      cls: "setting-item-description"
    });

    new Setting(containerEl)
      .setName("Mistral API Key")
      .setDesc("Required for OCR functionality (Mistral OCR)")
      .addText((text) =>
        text
          .setPlaceholder("Enter your Mistral API key")
          .setValue(this.plugin.settings.mistralApiKey)
          .onChange(async (value) => {
            this.plugin.settings.mistralApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Grok API Key")
      .setDesc("Required for translation (xAI Grok, OpenAI-compatible)")
      .addText((text) =>
        text
          .setPlaceholder("Enter your Grok/xAI API key")
          .setValue(this.plugin.settings.grokApiKey)
          .onChange(async (value) => {
            this.plugin.settings.grokApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Gemini API Key")
      .setDesc("Required for blog generation and slides creation")
      .addText((text) =>
        text
          .setPlaceholder("Enter your Google Gemini API key")
          .setValue(this.plugin.settings.geminiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.geminiApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    // ===== General Settings Section =====
    containerEl.createEl("h2", { text: "General Settings" });

    new Setting(containerEl)
      .setName("Output Folder")
      .setDesc("Folder where processed papers will be saved (relative to vault root)")
      .addText((text) =>
        text
          .setPlaceholder("papers")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value || "papers";
            await this.plugin.saveSettings();
          })
      );

    // ===== Model Settings Section =====
    containerEl.createEl("h2", { text: "Model Settings" });

    new Setting(containerEl)
      .setName("OCR Model")
      .setDesc("Mistral model for OCR processing")
      .addText((text) =>
        text
          .setPlaceholder("mistral-ocr-latest")
          .setValue(this.plugin.settings.ocrModel)
          .onChange(async (value) => {
            this.plugin.settings.ocrModel = value || "mistral-ocr-latest";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Translation Model")
      .setDesc("Grok model for translation (xAI)")
      .addText((text) =>
        text
          .setPlaceholder("grok-4-1-fast-non-reasoning")
          .setValue(this.plugin.settings.translationModel)
          .onChange(async (value) => {
            this.plugin.settings.translationModel = value || "grok-4-1-fast-non-reasoning";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Blog Model")
      .setDesc("Gemini model for blog generation")
      .addText((text) =>
        text
          .setPlaceholder("gemini-3-flash-preview")
          .setValue(this.plugin.settings.blogModel)
          .onChange(async (value) => {
            this.plugin.settings.blogModel = value || "gemini-3-flash-preview";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Slides Model")
      .setDesc("Gemini model for slides generation")
      .addText((text) =>
        text
          .setPlaceholder("gemini-3-flash-preview")
          .setValue(this.plugin.settings.slidesModel)
          .onChange(async (value) => {
            this.plugin.settings.slidesModel = value || "gemini-3-flash-preview";
            await this.plugin.saveSettings();
          })
      );

    // ===== Blog Settings Section =====
    containerEl.createEl("h2", { text: "Blog Settings" });

    new Setting(containerEl)
      .setName("Enable Blog Generation")
      .setDesc("Generate blog.md when running Full Pipeline")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableBlog)
          .onChange(async (value) => {
            this.plugin.settings.enableBlog = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Blog Style")
      .setDesc("Writing style for generated blog posts")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("technical", "Technical (Detailed, academic)")
          .addOption("summary", "Summary (Concise overview)")
          .addOption("tutorial", "Tutorial (Step-by-step explanation)")
          .setValue(this.plugin.settings.blogStyle)
          .onChange(async (value: "technical" | "summary" | "tutorial") => {
            this.plugin.settings.blogStyle = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Blog Language")
      .setDesc("Language for generated blog posts")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ko", "Korean (한국어)")
          .addOption("en", "English")
          .addOption("bilingual", "Bilingual (Both)")
          .setValue(this.plugin.settings.blogLanguage)
          .onChange(async (value: "ko" | "en" | "bilingual") => {
            this.plugin.settings.blogLanguage = value;
            await this.plugin.saveSettings();
          })
      );

    // ===== Slides Settings Section =====
    containerEl.createEl("h2", { text: "Slides Settings" });

    new Setting(containerEl)
      .setName("Enable Slides Generation")
      .setDesc("Generate slides.html when running Full Pipeline")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableSlides)
          .onChange(async (value) => {
            this.plugin.settings.enableSlides = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Number of Slides")
      .setDesc("How many slides to generate (3-10)")
      .addSlider((slider) =>
        slider
          .setLimits(3, 10, 1)
          .setValue(this.plugin.settings.slideCount)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.slideCount = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Slide Template")
      .setDesc("Visual style for generated slides")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("academic", "Academic (Clean, formal)")
          .addOption("minimal", "Minimal (Simple, less visual)")
          .addOption("modern", "Modern (Colorful, dynamic)")
          .setValue(this.plugin.settings.slideTemplate)
          .onChange(async (value: "academic" | "minimal" | "modern") => {
            this.plugin.settings.slideTemplate = value;
            await this.plugin.saveSettings();
          })
      );

    // ===== arXiv Settings Section =====
    containerEl.createEl("h2", { text: "arXiv Settings" });

    new Setting(containerEl)
      .setName("Default Category")
      .setDesc("Default arXiv category filter for searches")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("", "All Categories")
          .addOption("cs.AI", "Artificial Intelligence")
          .addOption("cs.CL", "Computation and Language (NLP)")
          .addOption("cs.CV", "Computer Vision")
          .addOption("cs.LG", "Machine Learning")
          .addOption("cs.IR", "Information Retrieval")
          .addOption("stat.ML", "Statistics - Machine Learning")
          .setValue(this.plugin.settings.arxivDefaultCategory)
          .onChange(async (value) => {
            this.plugin.settings.arxivDefaultCategory = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Max Results")
      .setDesc("Maximum number of search results to display (5-50)")
      .addSlider((slider) =>
        slider
          .setLimits(5, 50, 5)
          .setValue(this.plugin.settings.arxivMaxResults)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.arxivMaxResults = value;
            await this.plugin.saveSettings();
          })
      );

    // ===== Sidebar Settings Section =====
    containerEl.createEl("h2", { text: "Sidebar Settings" });

    new Setting(containerEl)
      .setName("Default Tab")
      .setDesc("Which tab to show when opening the sidebar")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("search", "Search (arXiv)")
          .addOption("process", "Process (PDF)")
          .addOption("papers", "Papers (Library)")
          .setValue(this.plugin.settings.sidebarDefaultTab)
          .onChange(async (value: "search" | "process" | "papers") => {
            this.plugin.settings.sidebarDefaultTab = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
