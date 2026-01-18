import { App, TFile, Notice } from "obsidian";
import { OpenAICompatibleClient, showError, showSuccess } from "../utils/api-client";
import type { PaperProcessorSettings } from "../settings";

export interface TranslationResult {
  success: boolean;
  faithfulTranslation?: string;
  readableTranslation?: string;
  structuredJson?: unknown;
  error?: string;
}

export interface TranslationProgress {
  phase: "phase1" | "phase2" | "phase3" | "complete";
  message: string;
  percent: number;
}

// Prompts for 3-phase translation pipeline
const FAITHFUL_TRANSLATION_PROMPT = `You are a professional academic translator specializing in computer science and machine learning papers.

CRITICAL RULES:
1. COMPLETENESS IS PRIORITY #1: Never summarize, skip, or omit any content
2. Translate EVERY sentence, EVERY paragraph, EVERY section
3. Preserve exact structure: same paragraph breaks, heading levels, list formats
4. Awkward phrasing is OK - Phase 2 will fix readability
5. Technical terms: "English(한국어)" format on first appearance
6. Keep all: Figure X, Table Y, Equation Z references exactly as-is
7. Preserve all LaTeX equations without modification
8. Keep markdown formatting intact

OUTPUT: Korean translation only. No explanations or comments.`;

const READABILITY_ENHANCEMENT_PROMPT = `You are a Korean academic editor improving translation readability.

INPUT: A faithful but potentially awkward Korean translation of an academic paper.

CRITICAL RULES:
1. PRESERVE ALL INFORMATION: Every fact, number, reference must remain
2. Split long sentences (40+ chars) into 2-3 shorter ones
3. Convert inline enumerations (3+ items) to bullet lists
4. Add blank lines between dense paragraphs for visual breathing room
5. Remove awkward passive voice where possible
6. Maintain formal academic tone (no honorifics in text)
7. Keep all technical terms, equations, and references exactly as-is

OUTPUT: Improved Korean text only. No explanations.`;

const STRUCTURED_PARSING_PROMPT = `Parse the following academic paper translation into structured JSON.

OUTPUT FORMAT:
{
  "metadata": {
    "title": "English title",
    "title_ko": "한국어 제목",
    "authors": ["Author 1", "Author 2"],
    "created": "YYYY-MM-DD"
  },
  "sections": [
    {
      "id": "section-1",
      "type": "abstract|introduction|related_work|method|experiment|result|discussion|conclusion|reference|appendix",
      "title": "Section Title",
      "title_ko": "섹션 제목",
      "paragraphs": [
        {
          "id": "p1",
          "original": "Original English paragraph",
          "translated": "번역된 한국어 문단",
          "figures": ["Figure 1"],
          "equations": ["$x^2$"],
          "tables": []
        }
      ]
    }
  ]
}

RULES:
1. 1:1 mapping: Each original paragraph maps to exactly one translated paragraph
2. Classify sections by content, not just by heading
3. Extract figure/equation/table references from each paragraph
4. Return valid JSON only, no markdown code blocks`;

/**
 * Translation Service for 3-phase academic paper translation
 */
export class TranslatorService {
  private app: App;
  private settings: PaperProcessorSettings;
  private onProgress?: (progress: TranslationProgress) => void;

  constructor(app: App, settings: PaperProcessorSettings) {
    this.app = app;
    this.settings = settings;
  }

  setProgressCallback(callback: (progress: TranslationProgress) => void): void {
    this.onProgress = callback;
  }

  private updateProgress(phase: TranslationProgress["phase"], message: string, percent: number): void {
    if (this.onProgress) {
      this.onProgress({ phase, message, percent });
    }
  }

  /**
   * Translate a paper using the configured mode
   */
  async translate(originalFile: TFile, outputFolder: string): Promise<TranslationResult> {
    if (!this.settings.grokApiKey) {
      return {
        success: false,
        error: "Grok API key not configured. Please set it in plugin settings.",
      };
    }

    try {
      const originalContent = await this.app.vault.read(originalFile);

      if (this.settings.translationMode === "faithful-only") {
        return await this.translateFaithfulOnly(originalContent, outputFolder);
      } else {
        return await this.translateFullPipeline(originalContent, outputFolder);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      showError(errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Faithful-only translation (Phase 1 only)
   */
  private async translateFaithfulOnly(content: string, outputFolder: string): Promise<TranslationResult> {
    this.updateProgress("phase1", "Phase 1: Faithful translation...", 20);

    const client = this.createClient();
    const faithfulResult = await this.runPhase1(client, content);

    if (!faithfulResult.success || !faithfulResult.data) {
      return { success: false, error: faithfulResult.error };
    }

    // Save faithful translation
    await this.saveFile(outputFolder, "translated_raw.md", faithfulResult.data);

    this.updateProgress("complete", "Translation complete!", 100);
    showSuccess("Translation complete (faithful mode)");

    return {
      success: true,
      faithfulTranslation: faithfulResult.data,
    };
  }

  /**
   * Full 3-phase translation pipeline
   */
  private async translateFullPipeline(content: string, outputFolder: string): Promise<TranslationResult> {
    const client = this.createClient();

    // Phase 1: Faithful Translation
    this.updateProgress("phase1", "Phase 1: Faithful translation...", 10);
    const phase1Result = await this.runPhase1(client, content);

    if (!phase1Result.success || !phase1Result.data) {
      return { success: false, error: phase1Result.error };
    }

    await this.saveFile(outputFolder, "translated_raw.md", phase1Result.data);

    // Phase 2: Readability Enhancement
    this.updateProgress("phase2", "Phase 2: Readability enhancement...", 40);
    const phase2Result = await this.runPhase2(client, phase1Result.data);

    if (!phase2Result.success || !phase2Result.data) {
      return { success: false, error: phase2Result.error };
    }

    await this.saveFile(outputFolder, "translated.md", phase2Result.data);

    // Phase 3: Structured Parsing
    this.updateProgress("phase3", "Phase 3: Structured parsing...", 70);
    const phase3Result = await this.runPhase3(client, content, phase2Result.data);

    if (!phase3Result.success || !phase3Result.data) {
      // Phase 3 failure is non-fatal, we still have translations
      console.warn("Phase 3 failed:", phase3Result.error);
    } else {
      await this.saveFile(outputFolder, "structured.json", JSON.stringify(phase3Result.data, null, 2));
    }

    this.updateProgress("complete", "Translation complete!", 100);
    showSuccess("Translation complete (full pipeline)");

    return {
      success: true,
      faithfulTranslation: phase1Result.data,
      readableTranslation: phase2Result.data,
      structuredJson: phase3Result.data,
    };
  }

  private createClient(): OpenAICompatibleClient {
    return new OpenAICompatibleClient(
      "https://api.x.ai/v1",
      this.settings.grokApiKey,
      this.settings.translationModel
    );
  }

  private async runPhase1(client: OpenAICompatibleClient, content: string) {
    // Split content into pages if marked, otherwise process as whole
    const pages = this.splitByPages(content);
    const translations: string[] = [];

    for (let i = 0; i < pages.length; i++) {
      const context = i > 0 ? translations[i - 1].slice(-200) : "";
      const prompt = context
        ? `[Previous context: ...${context}]\n\n${pages[i]}`
        : pages[i];

      const result = await client.chatCompletion([
        { role: "system", content: FAITHFUL_TRANSLATION_PROMPT },
        { role: "user", content: prompt },
      ], { temperature: 0.3, maxTokens: 16000 });

      if (!result.success || !result.data) {
        return result;
      }

      translations.push(result.data);

      // Rate limiting
      if (i < pages.length - 1) {
        await this.sleep(500);
      }
    }

    return { success: true, data: translations.join("\n\n") };
  }

  private async runPhase2(client: OpenAICompatibleClient, faithfulTranslation: string) {
    return await client.chatCompletion([
      { role: "system", content: READABILITY_ENHANCEMENT_PROMPT },
      { role: "user", content: faithfulTranslation },
    ], { temperature: 0.4, maxTokens: 16000 });
  }

  private async runPhase3(client: OpenAICompatibleClient, original: string, translated: string): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const prompt = `ORIGINAL (English):\n${original}\n\n---\n\nTRANSLATED (Korean):\n${translated}`;

    const result = await client.chatCompletion([
      { role: "system", content: STRUCTURED_PARSING_PROMPT },
      { role: "user", content: prompt },
    ], { temperature: 0.2, maxTokens: 32000 });

    if (!result.success || !result.data) {
      return result;
    }

    // Parse JSON from response
    try {
      // Remove markdown code blocks if present
      let jsonStr = result.data;
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```$/g, "").trim();
      }
      const parsed = JSON.parse(jsonStr);
      return { success: true, data: parsed };
    } catch {
      return { success: false, error: "Failed to parse structured JSON" };
    }
  }

  private splitByPages(content: string): string[] {
    const pageMarker = /<!-- Page \d+ -->/g;
    const parts = content.split(pageMarker).filter((p) => p.trim());
    return parts.length > 1 ? parts : [content];
  }

  private async saveFile(folder: string, filename: string, content: string): Promise<void> {
    const path = `${folder}/${filename}`;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
