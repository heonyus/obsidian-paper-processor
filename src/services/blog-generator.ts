import { App, TFile } from "obsidian";
import { GeminiClient, showError, showSuccess } from "../utils/api-client";
import type { PaperProcessorSettings } from "../settings";
import { arxivCategoriesToTags, extractTopicTags, addWikilinks } from "../utils/obsidian-format";

export interface BlogResult {
  success: boolean;
  content?: string;
  path?: string;
  error?: string;
}

export interface BlogProgress {
  stage: "analyzing" | "generating" | "saving" | "complete";
  message: string;
  percent: number;
}

// Obsidian-specific formatting instructions
const OBSIDIAN_FORMAT_INSTRUCTIONS = `
OBSIDIAN FORMATTING (MUST FOLLOW):
- Use wikilinks for key concepts: [[Concept Name]] (e.g., [[Transformer]], [[RAG]], [[Fine-tuning]])
- Use Obsidian callouts for important sections:
  > [!tip] Title
  > Content here

  > [!note] Note
  > Content here

  > [!warning] Caution
  > Content here

  > [!abstract] Abstract
  > Content here

- Add a "Related Concepts" section at the end with wikilinks to related topics
- Use #tags inline where appropriate (e.g., "This uses #attention-mechanism and #transformer architecture")
- For figures, reference them by description (e.g., "Figure 1에서 보여주듯이...") but do NOT use image embed syntax since actual filenames are unknown
`;

// Blog generation prompts by style
const BLOG_PROMPTS: Record<string, string> = {
  technical: `You are an expert technical writer creating a detailed blog post about an academic paper for Obsidian.

STRUCTURE:
1. **TL;DR** (3-5 bullet points in a callout box)
2. **Introduction** (Why this paper matters)
3. **Background** (Prerequisites for understanding, with wikilinks)
4. **Method** (Step-by-step explanation with examples)
5. **Key Results** (Quantitative results with interpretation)
6. **Limitations & Future Work**
7. **My Take** (Personal analysis and implications)
8. **Related Concepts** (List of [[wikilinks]] to related topics)

STYLE:
- Write for ML practitioners, not absolute beginners
- Include code snippets or pseudo-code where helpful
- Use analogies to explain complex concepts
- Reference specific figures/tables from the paper
- Add section for "What I would try next"
- Use Obsidian callouts for TL;DR, tips, and warnings
${OBSIDIAN_FORMAT_INSTRUCTIONS}`,

  summary: `You are creating a concise summary blog post about an academic paper for Obsidian.

STRUCTURE:
1. **One-Line Summary** (in a callout)
2. **Problem** (What problem does this solve?)
3. **Solution** (What's the key idea? with [[wikilinks]])
4. **Results** (What did they achieve?)
5. **Why It Matters**
6. **Related Concepts** ([[wikilinks]] list)

STYLE:
- Maximum 500 words
- Focus on the "so what?" factor
- No technical jargon unless absolutely necessary
- Suitable for sharing on social media
- Use Obsidian callouts for the summary
${OBSIDIAN_FORMAT_INSTRUCTIONS}`,

  tutorial: `You are creating a tutorial-style blog post based on an academic paper for Obsidian.

STRUCTURE:
1. **What You'll Learn** (callout box)
2. **Prerequisites** (with [[wikilinks]] to background knowledge)
3. **Step 1: Understanding the Problem**
4. **Step 2: The Core Idea**
5. **Step 3: How It Works** (with diagrams descriptions)
6. **Step 4: Implementation Notes** (code blocks)
7. **Step 5: Hands-on Exercise** (suggested experiments in callout)
8. **Further Reading** ([[wikilinks]] and external links)
9. **Related Concepts** ([[wikilinks]] list)

STYLE:
- Write as if teaching a workshop
- Use > [!tip] callouts for "Try This" exercises
- Explain every acronym on first use with [[wikilink]]
- Use > [!warning] callouts for "Common Mistakes to Avoid"
${OBSIDIAN_FORMAT_INSTRUCTIONS}`,
};

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  ko: "Write the entire blog post in Korean (한국어). Use natural Korean expressions suitable for a technical blog.",
  en: "Write the entire blog post in English.",
  bilingual: `Write the blog post with:
- Main content in Korean (한국어)
- Technical terms as "English(한국어)" format
- Include an English abstract at the top`,
};

/**
 * Blog Generator Service
 */
export class BlogGeneratorService {
  private app: App;
  private settings: PaperProcessorSettings;
  private onProgress?: (progress: BlogProgress) => void;

  constructor(app: App, settings: PaperProcessorSettings) {
    this.app = app;
    this.settings = settings;
  }

  setProgressCallback(callback: (progress: BlogProgress) => void): void {
    this.onProgress = callback;
  }

  private updateProgress(stage: BlogProgress["stage"], message: string, percent: number): void {
    if (this.onProgress) {
      this.onProgress({ stage, message, percent });
    }
  }

  /**
   * Generate a blog post from a paper
   */
  async generate(paperFolder: string): Promise<BlogResult> {
    if (!this.settings.geminiApiKey) {
      return {
        success: false,
        error: "Gemini API key not configured. Please set it in plugin settings.",
      };
    }

    try {
      this.updateProgress("analyzing", "Reading paper content...", 10);

      // Try to read translated content first, fall back to original
      const content = await this.getPaperContent(paperFolder);
      if (!content) {
        return {
          success: false,
          error: "No paper content found. Run OCR or provide markdown files.",
        };
      }

      // Read metadata if available
      const metadata = await this.getMetadata(paperFolder);

      this.updateProgress("generating", "Generating blog post...", 30);

      // Build prompt
      const stylePrompt = BLOG_PROMPTS[this.settings.blogStyle] || BLOG_PROMPTS.technical;
      const langInstruction = LANGUAGE_INSTRUCTIONS[this.settings.blogLanguage] || LANGUAGE_INSTRUCTIONS.ko;

      const fullPrompt = `${stylePrompt}

${langInstruction}

---
PAPER TITLE: ${metadata?.title || "Unknown"}
${metadata?.title_ko ? `KOREAN TITLE: ${metadata.title_ko}` : ""}
---

PAPER CONTENT:
${content}

---
Generate the blog post now. Output markdown only, no explanations.`;

      // Call Gemini
      const client = new GeminiClient(this.settings.geminiApiKey, this.settings.blogModel);
      const result = await client.generateContent(fullPrompt, {
        temperature: 0.7,
        maxOutputTokens: 8192,
      });

      if (!result.success || !result.data) {
        return {
          success: false,
          error: result.error || "Blog generation failed",
        };
      }

      this.updateProgress("saving", "Saving blog post...", 80);

      // Clean up response (remove code blocks if present)
      let blogContent = result.data;
      if (blogContent.startsWith("```")) {
        blogContent = blogContent.replace(/```markdown?\n?/g, "").replace(/```$/g, "").trim();
      }

      // Add frontmatter (pass content for topic tag extraction)
      const frontmatter = this.generateFrontmatter(metadata, content);
      const finalContent = `${frontmatter}\n\n${blogContent}`;

      // Save blog post
      const blogPath = `${paperFolder}/blog.md`;
      const existing = this.app.vault.getAbstractFileByPath(blogPath);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, finalContent);
      } else {
        await this.app.vault.create(blogPath, finalContent);
      }

      this.updateProgress("complete", "Blog post generated!", 100);
      showSuccess("Blog post generated successfully");

      return {
        success: true,
        content: finalContent,
        path: blogPath,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      showError(errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get paper content (prefer translated, fall back to original)
   */
  private async getPaperContent(folder: string): Promise<string | null> {
    const priorities = ["translated.md", "translated_raw.md", "original.md"];

    for (const filename of priorities) {
      const path = `${folder}/${filename}`;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        return await this.app.vault.read(file);
      }
    }

    return null;
  }

  /**
   * Get paper metadata
   */
  private async getMetadata(folder: string): Promise<Record<string, string> | null> {
    const path = `${folder}/metadata.json`;
    const file = this.app.vault.getAbstractFileByPath(path);

    if (file instanceof TFile) {
      try {
        const content = await this.app.vault.read(file);
        return JSON.parse(content);
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Generate YAML frontmatter for blog post with Obsidian tags
   */
  private generateFrontmatter(metadata: Record<string, any> | null, content?: string): string {
    const now = new Date().toISOString().split("T")[0];
    const title = metadata?.title || "Untitled Paper";
    const titleKo = metadata?.title_ko || "";

    // Collect all tags
    const tags = new Set<string>(["paper-review", this.settings.blogStyle]);

    // Add tags from arXiv categories
    if (metadata?.categories && Array.isArray(metadata.categories)) {
      const categoryTags = arxivCategoriesToTags(metadata.categories);
      categoryTags.forEach(tag => tags.add(tag.replace(/^#/, "")));
    }

    // Add topic tags from content analysis
    if (content) {
      const topicTags = extractTopicTags(content);
      topicTags.forEach(tag => tags.add(tag.replace(/^#/, "")));
    }

    // Add tags from title
    if (title) {
      const titleTags = extractTopicTags(title);
      titleTags.forEach(tag => tags.add(tag.replace(/^#/, "")));
    }

    const tagsArray = Array.from(tags);

    return `---
title: "${this.escapeYaml(titleKo || title)}"
date: ${now}
tags:
${tagsArray.map(t => `  - ${t}`).join("\n")}
paper_title: "${this.escapeYaml(title)}"
${titleKo ? `paper_title_ko: "${this.escapeYaml(titleKo)}"` : ""}
${metadata?.arxiv_id ? `arxiv_id: "${metadata.arxiv_id}"` : ""}
${metadata?.arxiv_id ? `arxiv_url: "https://arxiv.org/abs/${metadata.arxiv_id}"` : ""}
style: ${this.settings.blogStyle}
language: ${this.settings.blogLanguage}
---`;
  }

  private escapeYaml(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\n/g, " ");
  }
}
