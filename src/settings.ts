import { App, PluginSettingTab, Setting } from "obsidian";
import type PaperProcessorPlugin from "./main";

export interface PaperProcessorSettings {
  // API Keys
  mistralApiKey: string;
  grokApiKey: string;
  geminiApiKey: string;

  // General Settings
  outputFolder: string;

  // Translation Settings
  translationMode: "faithful-only" | "full-pipeline";
  translationModel: string;

  // Slides Settings
  slideCount: number;
  slideTemplate: "academic" | "minimal" | "modern";

  // Blog Settings
  blogStyle: "technical" | "summary" | "tutorial";
  blogLanguage: "ko" | "en" | "bilingual";
}

export const DEFAULT_SETTINGS: PaperProcessorSettings = {
  // API Keys (empty by default - user must provide)
  mistralApiKey: "",
  grokApiKey: "",
  geminiApiKey: "",

  // General Settings
  outputFolder: "papers",

  // Translation Settings
  translationMode: "full-pipeline",
  translationModel: "grok-3-fast",

  // Slides Settings
  slideCount: 5,
  slideTemplate: "academic",

  // Blog Settings
  blogStyle: "technical",
  blogLanguage: "ko",
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

    // ===== Translation Settings Section =====
    containerEl.createEl("h2", { text: "Translation Settings" });

    new Setting(containerEl)
      .setName("Translation Mode")
      .setDesc("faithful-only: Direct translation | full-pipeline: 3-phase (faithful → readable → structured)")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("faithful-only", "Faithful Only (Fast)")
          .addOption("full-pipeline", "Full Pipeline (Best Quality)")
          .setValue(this.plugin.settings.translationMode)
          .onChange(async (value: "faithful-only" | "full-pipeline") => {
            this.plugin.settings.translationMode = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Translation Model")
      .setDesc("Grok model to use for translation")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("grok-3-fast", "Grok 3 Fast")
          .addOption("grok-3", "Grok 3")
          .addOption("grok-2", "Grok 2")
          .setValue(this.plugin.settings.translationModel)
          .onChange(async (value) => {
            this.plugin.settings.translationModel = value;
            await this.plugin.saveSettings();
          })
      );

    // ===== Slides Settings Section =====
    containerEl.createEl("h2", { text: "Slides Settings" });

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

    // ===== Blog Settings Section =====
    containerEl.createEl("h2", { text: "Blog Settings" });

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
  }
}
