import { App, PluginSettingTab, Setting } from "obsidian";
import type PaperProcessorPlugin from "./main";

export interface PaperProcessorSettings {
  // API Keys
  mistralApiKey: string;
  grokApiKey: string;
  geminiApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  deepseekApiKey: string;
  groqApiKey: string;

  // General Settings
  outputFolder: string;

  // Model Settings
  ocrModel: string;
  translationModel: string;
  translationLanguage: string;
  blogModel: string;

  // Blog Settings
  enableBlog: boolean;
  blogStyle: "technical" | "summary" | "tutorial";
  blogLanguage: "ko" | "en" | "bilingual";

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
  openaiApiKey: "",
  anthropicApiKey: "",
  deepseekApiKey: "",
  groqApiKey: "",

  // General Settings
  outputFolder: "papers",

  // Model Settings
  ocrModel: "mistral-ocr-latest",
  translationModel: "gemini-2.5-flash-lite",
  translationLanguage: "Korean",
  blogModel: "gemini-2.5-flash-lite",

  // Blog Settings
  enableBlog: true,
  blogStyle: "technical",
  blogLanguage: "ko",

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
    new Setting(containerEl).setName("API keys").setHeading();
    containerEl.createEl("p", {
      text: "Enter your API keys. These are stored locally and never sent anywhere except to the respective API services.",
      cls: "setting-item-description"
    });

    new Setting(containerEl)
      .setName("Mistral API key")
      .setDesc("Required for OCR functionality (Mistral OCR).")
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
      .setName("xAI Grok API key")
      .setDesc("For Grok models (grok-4.1, grok-4, etc.).")
      .addText((text) =>
        text
          .setPlaceholder("Enter your xAI API key")
          .setValue(this.plugin.settings.grokApiKey)
          .onChange(async (value) => {
            this.plugin.settings.grokApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("OpenAI API key")
      .setDesc("For GPT models (gpt-5.2, gpt-4o, etc.).")
      .addText((text) =>
        text
          .setPlaceholder("Enter your OpenAI API key")
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openaiApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Anthropic API key")
      .setDesc("For Claude models (claude-4.5-opus, claude-4.5-sonnet, etc.).")
      .addText((text) =>
        text
          .setPlaceholder("Enter your Anthropic API key")
          .setValue(this.plugin.settings.anthropicApiKey)
          .onChange(async (value) => {
            this.plugin.settings.anthropicApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Google Gemini API key")
      .setDesc("For Gemini models (gemini-3.0-pro, gemini-3.0-flash, etc.).")
      .addText((text) =>
        text
          .setPlaceholder("Enter your Google Gemini API key")
          .setValue(this.plugin.settings.geminiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.geminiApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("DeepSeek API key")
      .setDesc("For DeepSeek models (deepseek-r1, deepseek-v3, etc.).")
      .addText((text) =>
        text
          .setPlaceholder("Enter your DeepSeek API key")
          .setValue(this.plugin.settings.deepseekApiKey)
          .onChange(async (value) => {
            this.plugin.settings.deepseekApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Groq API key")
      .setDesc("For fast inference models via Groq.")
      .addText((text) =>
        text
          .setPlaceholder("Enter your Groq API key")
          .setValue(this.plugin.settings.groqApiKey)
          .onChange(async (value) => {
            this.plugin.settings.groqApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    // ===== General Settings Section =====
    new Setting(containerEl).setName("General settings").setHeading();

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc("Folder where processed papers will be saved (relative to vault root).")
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
    new Setting(containerEl).setName("Model settings").setHeading();

    new Setting(containerEl)
      .setName("OCR model")
      .setDesc("Mistral model for OCR processing (fixed).")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.ocrModel)
          .setDisabled(true)
      );

    new Setting(containerEl)
      .setName("Translation model")
      .setDesc("Select AI model for translation (requires corresponding API key).")
      .addDropdown((dropdown) =>
        dropdown
          // xAI Grok models (latest)
          .addOption("grok-4.1-fast-non-reasoning", "Grok 4.1 Fast Non-Reasoning (xAI)")
          .addOption("grok-4.1-fast", "Grok 4.1 Fast (xAI)")
          .addOption("grok-4.1", "Grok 4.1 (xAI)")
          // OpenAI models (latest: 5.2)
          .addOption("gpt-5.2", "GPT-5.2 (OpenAI)")
          .addOption("gpt-5.2-mini", "GPT-5.2 Mini (OpenAI)")
          .addOption("gpt-4o", "GPT-4o (OpenAI)")
          // Anthropic Claude models (latest: 4.5)
          .addOption("claude-4.5-opus", "Claude 4.5 Opus (Anthropic)")
          .addOption("claude-4.5-sonnet", "Claude 4.5 Sonnet (Anthropic)")
          .addOption("claude-4.5-haiku", "Claude 4.5 Haiku (Anthropic)")
          // Google Gemini models
          .addOption("gemini-3.0-pro", "Gemini 3.0 Pro (Google)")
          .addOption("gemini-3.0-flash", "Gemini 3.0 Flash (Google)")
          .addOption("gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite (Google)")
          // DeepSeek models
          .addOption("deepseek-r1", "DeepSeek R1 (DeepSeek)")
          .addOption("deepseek-v3", "DeepSeek V3 (DeepSeek)")
          // Groq models (fast inference)
          .addOption("llama-3.3-70b-versatile", "Llama 3.3 70B (Groq)")
          .addOption("deepseek-r1-distill-llama-70b", "DeepSeek R1 Distill 70B (Groq)")
          .setValue(this.plugin.settings.translationModel)
          .onChange(async (value) => {
            this.plugin.settings.translationModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Translation language")
      .setDesc("Target language for paper translation.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("Korean", "Korean (한국어)")
          .addOption("Japanese", "Japanese (日本語)")
          .addOption("Chinese", "Chinese (中文)")
          .addOption("Spanish", "Spanish (Español)")
          .addOption("French", "French (Français)")
          .addOption("German", "German (Deutsch)")
          .addOption("Portuguese", "Portuguese (Português)")
          .addOption("Russian", "Russian (Русский)")
          .addOption("Italian", "Italian (Italiano)")
          .addOption("Vietnamese", "Vietnamese (Tiếng Việt)")
          .setValue(this.plugin.settings.translationLanguage)
          .onChange(async (value) => {
            this.plugin.settings.translationLanguage = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Blog model")
      .setDesc("Select AI model for blog generation (requires corresponding API key).")
      .addDropdown((dropdown) =>
        dropdown
          // xAI Grok models (latest)
          .addOption("grok-4.1-fast-non-reasoning", "Grok 4.1 Fast Non-Reasoning (xAI)")
          .addOption("grok-4.1-fast", "Grok 4.1 Fast (xAI)")
          .addOption("grok-4.1", "Grok 4.1 (xAI)")
          // OpenAI models (latest: 5.2)
          .addOption("gpt-5.2", "GPT-5.2 (OpenAI)")
          .addOption("gpt-5.2-mini", "GPT-5.2 Mini (OpenAI)")
          .addOption("gpt-4o", "GPT-4o (OpenAI)")
          // Anthropic Claude models (latest: 4.5)
          .addOption("claude-4.5-opus", "Claude 4.5 Opus (Anthropic)")
          .addOption("claude-4.5-sonnet", "Claude 4.5 Sonnet (Anthropic)")
          .addOption("claude-4.5-haiku", "Claude 4.5 Haiku (Anthropic)")
          // Google Gemini models
          .addOption("gemini-3.0-pro", "Gemini 3.0 Pro (Google)")
          .addOption("gemini-3.0-flash", "Gemini 3.0 Flash (Google)")
          .addOption("gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite (Google)")
          // DeepSeek models
          .addOption("deepseek-r1", "DeepSeek R1 (DeepSeek)")
          .addOption("deepseek-v3", "DeepSeek V3 (DeepSeek)")
          // Groq models (fast inference)
          .addOption("llama-3.3-70b-versatile", "Llama 3.3 70B (Groq)")
          .addOption("deepseek-r1-distill-llama-70b", "DeepSeek R1 Distill 70B (Groq)")
          .setValue(this.plugin.settings.blogModel)
          .onChange(async (value) => {
            this.plugin.settings.blogModel = value;
            await this.plugin.saveSettings();
          })
      );

    // ===== Blog Settings Section =====
    new Setting(containerEl).setName("Blog settings").setHeading();

    new Setting(containerEl)
      .setName("Enable blog generation")
      .setDesc("Generate blog.md when running full pipeline.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableBlog)
          .onChange(async (value) => {
            this.plugin.settings.enableBlog = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Blog style")
      .setDesc("Writing style for generated blog posts.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("technical", "Technical (detailed, academic)")
          .addOption("summary", "Summary (concise overview)")
          .addOption("tutorial", "Tutorial (step-by-step explanation)")
          .setValue(this.plugin.settings.blogStyle)
          .onChange(async (value: "technical" | "summary" | "tutorial") => {
            this.plugin.settings.blogStyle = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Blog language")
      .setDesc("Language for generated blog posts.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ko", "Korean (한국어)")
          .addOption("en", "English")
          .addOption("bilingual", "Bilingual (both)")
          .setValue(this.plugin.settings.blogLanguage)
          .onChange(async (value: "ko" | "en" | "bilingual") => {
            this.plugin.settings.blogLanguage = value;
            await this.plugin.saveSettings();
          })
      );

    // ===== arXiv Settings Section =====
    new Setting(containerEl).setName("arXiv settings").setHeading();

    new Setting(containerEl)
      .setName("Default category")
      .setDesc("Default arXiv category filter for searches.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("", "All categories")
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
      .setName("Max results")
      .setDesc("Maximum number of search results to display (5-50).")
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
    new Setting(containerEl).setName("Sidebar settings").setHeading();

    new Setting(containerEl)
      .setName("Default tab")
      .setDesc("Which tab to show when opening the sidebar.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("search", "Search (arXiv)")
          .addOption("process", "Process (PDF)")
          .addOption("papers", "Papers (library)")
          .setValue(this.plugin.settings.sidebarDefaultTab)
          .onChange(async (value: "search" | "process" | "papers") => {
            this.plugin.settings.sidebarDefaultTab = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
