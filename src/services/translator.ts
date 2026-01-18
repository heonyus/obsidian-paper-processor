import { App, TFile } from "obsidian";
import { OpenAICompatibleClient, GeminiClient, showError, showSuccess } from "../utils/api-client";
import type { PaperProcessorSettings } from "../settings";

export interface TranslationResult {
  success: boolean;
  translation?: string;
  error?: string;
}

export interface TranslationProgress {
  phase: "translating" | "complete";
  message: string;
  percent: number;
  currentPage?: number;
  totalPages?: number;
}

// Faithful translation prompt template (multi-language support)
const FAITHFUL_TRANSLATION_PROMPT = `You are a professional translator specializing in AI/ML academic papers.

## CRITICAL RULES

1. **Language**:
   - Output MUST be written entirely in {target_language}.
   - Translate ALL sentences completely. No source language sentences should remain untranslated.

2. **Completeness is Top Priority**:
   - Translate every sentence, every word
   - NO abbreviation, summarization, or omission allowed
   - NO adding information, NO changing meaning

3. **Technical Term Annotation (Mandatory)**:
   - For AI/CS academic terms, annotate with English(target language translation) on first occurrence
   - Example: LLM(Large Language Model), attention mechanism(attention mechanism in {target_language})
   - On reoccurrence, you may use English only or English(translation)
   - Proper nouns, model names, and dataset names should remain in English

4. **Preserve Equations/References**:
   - Do NOT modify any content within equations ($$...$$, $...$)
   - Maintain Figure X, Table Y, Equation Z, citation [1] formats
   - Preserve section references

5. **OCR Readability Correction Allowed (Content Unchanged)**:
   - Paragraph/line breaks may be adjusted for readability
   - If a line continues for 4-5+ lines, add line breaks at sentence boundaries
   - If a paragraph has 4-5+ sentences, split into 2-3 paragraphs
   - Lists of 3+ items may be converted to bullets (-) or numbering (1., 2., 3.)
   - "(1)...(2)...(3)..." patterns should be organized into numbered lists

6. **Equation Block Formatting**:
   - If \`$$\` appears alone, try to match block pairs when possible
   - Do NOT modify the equation content itself

7. **Readability Enhancement Rules**:
   - Split long sentences (40+ characters) into 2-3 sentences
   - Add 1 blank line after each sentence
   - Merge very short sentences (<10 characters) if it flows naturally
   - Complex conditionals/enumerations should be split into bullets
   - Long paragraphs (5+ sentences) should be split at topic transitions
   - Minimize unnecessary passive voice/redundant expressions while preserving meaning
   - Simplify verbose expressions while keeping the meaning intact

8. **Formatting/LaTeX Rendering Correction**:
   - Key terms/subheadings that need emphasis may use bold (**...**) or italics (*...*)
   - Do not overuse or change the original meaning
   - Check LaTeX equations for balanced parentheses/braces/backslashes
   - Fix broken tokens/missing parentheses/incorrect delimiters in commands like \`\\mathcal\`, \`\\mathbf\`, \`\\langle\` based on context
   - Preserve equation content, but restore broken tokens/missing parentheses/incorrect delimiters

## Translation Style

- Use formal academic tone appropriate for {target_language}
- Use declarative statements
- Maintain scholarly register throughout

## Previous Context (Reference only, do NOT translate)
{previous_context}

## Current Page (Translate the content below)
{text}

## Output
Output pure markdown only (no code blocks).
Preserve the content as-is, but readability improvements via line breaks/list formatting are allowed.`;

/**
 * Translation Service - 기존 paper-ocr-translator와 동일한 동작
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

  private updateProgress(phase: TranslationProgress["phase"], message: string, percent: number, currentPage?: number, totalPages?: number): void {
    if (this.onProgress) {
      this.onProgress({ phase, message, percent, currentPage, totalPages });
    }
  }

  /**
   * Check if the correct API key is configured for the selected model
   */
  private checkApiKey(model: string): string | null {
    if (model.startsWith("grok-") && !this.settings.grokApiKey) {
      return "xAI Grok API key not configured. Please set it in plugin settings.";
    }
    if (model.startsWith("gpt-") && !this.settings.openaiApiKey) {
      return "OpenAI API key not configured. Please set it in plugin settings.";
    }
    if (model.startsWith("claude-") && !this.settings.anthropicApiKey) {
      return "Anthropic API key not configured. Please set it in plugin settings.";
    }
    if (model.startsWith("gemini-") && !this.settings.geminiApiKey) {
      return "Gemini API key not configured. Please set it in plugin settings.";
    }
    if (model.startsWith("deepseek-") && !model.includes("distill") && !this.settings.deepseekApiKey) {
      return "DeepSeek API key not configured. Please set it in plugin settings.";
    }
    if ((model.startsWith("llama-") || model.includes("distill")) && !this.settings.groqApiKey) {
      return "Groq API key not configured. Please set it in plugin settings.";
    }
    return null;
  }

  /**
   * Translate a paper (faithful translation only)
   */
  async translate(originalFile: TFile, outputFolder: string): Promise<TranslationResult> {
    // Check for the correct API key based on model
    const model = this.settings.translationModel;
    const apiKeyError = this.checkApiKey(model);
    if (apiKeyError) {
      return {
        success: false,
        error: apiKeyError,
      };
    }

    try {
      const originalContent = await this.app.vault.read(originalFile);
      return await this.translateFaithful(originalContent, outputFolder);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      showError(errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Faithful translation - page by page with context passing
   */
  private async translateFaithful(content: string, outputFolder: string): Promise<TranslationResult> {
    const pages = this.splitByPages(content);
    const translations: string[] = [];
    let previousContext = "(First page)";
    const targetLanguage = this.settings.translationLanguage || "Korean";
    const model = this.settings.translationModel;
    const isGemini = model.startsWith("gemini-");

    this.updateProgress("translating", "Starting translation...", 0, 0, pages.length);

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const percent = Math.round(((i + 1) / pages.length) * 100);

      this.updateProgress("translating", `Translating page ${i + 1}/${pages.length}...`, percent, i + 1, pages.length);

      // Build prompt with context and target language
      const prompt = FAITHFUL_TRANSLATION_PROMPT
        .replace(/{target_language}/g, targetLanguage)
        .replace("{previous_context}", previousContext)
        .replace("{text}", page);

      let result: { success: boolean; data?: string; error?: string };

      if (isGemini) {
        const geminiClient = new GeminiClient(this.settings.geminiApiKey, model);
        result = await geminiClient.generateContent(prompt, { temperature: 0.3, maxOutputTokens: 16000 });
      } else {
        const client = this.createClient();
        result = await client.chatCompletion([
          { role: "user", content: prompt },
        ], { temperature: 0.3, maxTokens: 16000 });
      }

      if (!result.success || !result.data) {
        return { success: false, error: result.error || "Translation failed" };
      }

      // Remove code blocks if LLM wrapped output
      let translated = result.data;
      if (translated.startsWith("```")) {
        const lines = translated.split("\n");
        if (lines[0].startsWith("```")) {
          lines.shift();
        }
        if (lines.length > 0 && lines[lines.length - 1].trim() === "```") {
          lines.pop();
        }
        translated = lines.join("\n");
      }

      translations.push(translated);

      // Update context for next page (last 200 chars)
      previousContext = translated.length > 200 ? translated.slice(-200) : translated;

      // Rate limiting
      if (i < pages.length - 1) {
        await this.sleep(500);
      }
    }

    // Save translation
    const fullTranslation = translations.join("\n\n");
    await this.saveFile(outputFolder, "translated_raw.md", fullTranslation);

    this.updateProgress("complete", "Translation complete!", 100);
    showSuccess("Translation complete!");

    return {
      success: true,
      translation: fullTranslation,
    };
  }

  private createClient(): OpenAICompatibleClient {
    const model = this.settings.translationModel;
    let baseUrl: string;
    let apiKey: string;

    if (model.startsWith("grok-")) {
      baseUrl = "https://api.x.ai/v1";
      apiKey = this.settings.grokApiKey;
    } else if (model.startsWith("gpt-")) {
      baseUrl = "https://api.openai.com/v1";
      apiKey = this.settings.openaiApiKey;
    } else if (model.startsWith("claude-")) {
      baseUrl = "https://api.anthropic.com/v1";
      apiKey = this.settings.anthropicApiKey;
    } else if (model.startsWith("gemini-")) {
      baseUrl = "https://generativelanguage.googleapis.com/v1beta";
      apiKey = this.settings.geminiApiKey;
    } else if (model.startsWith("deepseek-") && !model.includes("distill")) {
      baseUrl = "https://api.deepseek.com/v1";
      apiKey = this.settings.deepseekApiKey;
    } else if (model.startsWith("llama-") || model.includes("distill")) {
      // Groq models
      baseUrl = "https://api.groq.com/openai/v1";
      apiKey = this.settings.groqApiKey;
    } else {
      // Default to Gemini
      baseUrl = "https://generativelanguage.googleapis.com/v1beta";
      apiKey = this.settings.geminiApiKey;
    }

    console.log(`[Translator] Model: ${model}, API: ${baseUrl}`);
    return new OpenAICompatibleClient(baseUrl, apiKey, model);
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
