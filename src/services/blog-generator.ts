import { App, TFile, TFolder } from "obsidian";
import { GeminiClient, ImageData, showError, showSuccess } from "../utils/api-client";
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
   * Generate a blog post from a paper using Multimodal API
   */
  async generate(paperFolder: string): Promise<BlogResult> {
    if (!this.settings.geminiApiKey) {
      return {
        success: false,
        error: "Gemini API key not configured. Please set it in plugin settings.",
      };
    }

    try {
      this.updateProgress("analyzing", `📂 Reading from folder: ${paperFolder}`, 5);

      // Try to read translated content first, fall back to original
      const content = await this.getPaperContent(paperFolder);
      if (!content) {
        return {
          success: false,
          error: "No paper content found. Run OCR or provide markdown files.",
        };
      }
      const contentLength = content.length;
      const wordCount = content.split(/\s+/).length;
      this.updateProgress("analyzing", `📄 Paper content loaded: ${wordCount.toLocaleString()} words (${(contentLength / 1024).toFixed(1)}KB)`, 10);

      // Read metadata if available
      const metadata = await this.getMetadata(paperFolder);
      if (metadata) {
        this.updateProgress("analyzing", `📋 Metadata: "${metadata.title || 'Unknown'}"`, 15);
        if (metadata.arxiv_id) {
          this.updateProgress("analyzing", `🔗 arXiv ID: ${metadata.arxiv_id}`, 17);
        }
      } else {
        this.updateProgress("analyzing", "⚠️ No metadata.json found", 15);
      }

      // Load images with Base64 data for multimodal API
      this.updateProgress("analyzing", "🖼️ Loading images for multimodal analysis...", 20);
      const images = await this.loadImagesWithData(paperFolder, 10);

      if (images.length > 0) {
        this.updateProgress("analyzing", `🖼️ Loaded ${images.length} images: ${images.slice(0, 3).map(i => i.name).join(", ")}${images.length > 3 ? "..." : ""}`, 22);

        // Analyze each image individually (Deep Analysis) with text alignment
        const client = new GeminiClient(this.settings.geminiApiKey, this.settings.blogModel);

        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          this.updateProgress("analyzing", `🔍 Deep analyzing image (${i + 1}/${images.length}): ${img.name}`, 25 + (i * 3));

          try {
            // Pass full content for context extraction per image
            const analysis = await this.analyzeImage(client, img, content, metadata);
            img.analysis = analysis;
            this.updateProgress("analyzing", `✅ Analyzed: ${img.name}`, 25 + ((i + 1) * 3));
          } catch (err) {
            console.error(`Failed to analyze image ${img.name}:`, err);
            img.analysis = "(분석 실패)";
          }
        }
      } else {
        this.updateProgress("analyzing", "⚠️ No images found in images/ folder", 25);
      }

      this.updateProgress("generating", `🤖 Model: ${this.settings.blogModel}`, 55);
      this.updateProgress("generating", `🌐 Language: ${this.settings.blogLanguage}, Style: ${this.settings.blogStyle}`, 58);
      this.updateProgress("generating", "⏳ Generating blog with multimodal API (this may take 1-2 minutes)...", 60);

      // Build prompt with image analysis results
      const stylePrompt = BLOG_PROMPTS[this.settings.blogStyle] || BLOG_PROMPTS.technical;
      const langInstruction = LANGUAGE_INSTRUCTIONS[this.settings.blogLanguage] || LANGUAGE_INSTRUCTIONS.ko;

      // Build image instruction with deep analysis results
      let imageInstruction = "";
      if (images.length > 0) {
        imageInstruction = `\n\n## AVAILABLE IMAGES WITH ANALYSIS
You MUST include these images in your blog post with Obsidian embed syntax ![[images/filename]].
For each image, write detailed explanations based on the analysis provided.

`;
        for (const img of images) {
          imageInstruction += `### ${img.relativePath}
[Deep Analysis]
${img.analysis || "(No analysis available)"}

`;
        }
        imageInstruction += `
IMPORTANT:
- Include ALL relevant images in appropriate sections
- For each image, write 10-15 lines of detailed explanation
- Reference specific details from the analysis above
- Use Obsidian embed syntax: ![[${images[0].relativePath}]]
`;
      }

      const fullPrompt = `${stylePrompt}

${langInstruction}
${imageInstruction}

---
PAPER TITLE: ${metadata?.title || "Unknown"}
${metadata?.title_ko ? `KOREAN TITLE: ${metadata.title_ko}` : ""}
---

PAPER CONTENT:
${content}

---
Generate the blog post now. Output markdown only, no explanations.`;

      // Call Gemini with images (Multimodal)
      const client = new GeminiClient(this.settings.geminiApiKey, this.settings.blogModel);
      const promptLength = fullPrompt.length;
      this.updateProgress("generating", `📝 Prompt size: ${(promptLength / 1024).toFixed(1)}KB + ${images.length} images`, 65);

      const startTime = Date.now();

      // Use multimodal API if we have images
      let result;
      if (images.length > 0) {
        result = await client.generateContentWithImages(fullPrompt, images, {
          temperature: 0.7,
          maxOutputTokens: 8192,
        });
      } else {
        result = await client.generateContent(fullPrompt, {
          temperature: 0.7,
          maxOutputTokens: 8192,
        });
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (!result.success || !result.data) {
        this.updateProgress("generating", `❌ API Error: ${result.error}`, 70);
        return {
          success: false,
          error: result.error || "Blog generation failed",
        };
      }

      const outputLength = result.data.length;
      this.updateProgress("generating", `✅ Response received in ${elapsed}s (${(outputLength / 1024).toFixed(1)}KB)`, 85);
      this.updateProgress("saving", "💾 Processing and saving blog post...", 90);

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
        this.updateProgress("saving", `📝 Updated existing: ${blogPath}`, 95);
      } else {
        await this.app.vault.create(blogPath, finalContent);
        this.updateProgress("saving", `📝 Created new file: ${blogPath}`, 95);
      }

      const finalWordCount = finalContent.split(/\s+/).length;
      this.updateProgress("complete", `✅ Blog post generated! (${finalWordCount.toLocaleString()} words)`, 100);
      this.updateProgress("complete", `🖼️ Included ${images.length} images with detailed analysis`, 100);
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
   * Load images with Base64 data for multimodal API
   */
  private async loadImagesWithData(folder: string, maxImages = 10, maxImageBytes = 4 * 1024 * 1024): Promise<Array<ImageData & { name: string; relativePath: string; analysis?: string }>> {
    const imagesFolder = this.app.vault.getAbstractFileByPath(`${folder}/images`);

    if (!(imagesFolder instanceof TFolder)) {
      return [];
    }

    const imageFiles: TFile[] = [];
    for (const child of imagesFolder.children) {
      if (child instanceof TFile && /\.(png|jpg|jpeg|gif|webp)$/i.test(child.name)) {
        imageFiles.push(child);
      }
    }

    // Natural sort (img-1, img-2, ..., img-10 instead of img-1, img-10, img-2)
    imageFiles.sort((a, b) => {
      const numA = parseInt(a.name.match(/\d+/)?.[0] || "0", 10);
      const numB = parseInt(b.name.match(/\d+/)?.[0] || "0", 10);
      return numA - numB;
    });
    const filesToProcess = imageFiles.slice(0, maxImages);

    const images: Array<ImageData & { name: string; relativePath: string; analysis?: string }> = [];

    for (const file of filesToProcess) {
      try {
        // Check file size
        const stats = await this.app.vault.adapter.stat(`${folder}/images/${file.name}`);
        if (stats && stats.size > maxImageBytes) {
          console.log(`⚠️ Skipping large image: ${file.name} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
          continue;
        }

        // Read binary and convert to base64
        const arrayBuffer = await this.app.vault.readBinary(file);
        const base64 = this.arrayBufferToBase64(arrayBuffer);

        // Determine MIME type
        const ext = file.extension.toLowerCase();
        const mimeTypes: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
        };
        const mimeType = mimeTypes[ext] || "image/png";

        images.push({
          name: file.name,
          relativePath: `images/${file.name}`,
          mimeType,
          data: base64,
        });
      } catch (err) {
        console.error(`Failed to load image ${file.name}:`, err);
      }
    }

    return images;
  }

  /**
   * Convert ArrayBuffer to Base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Extract context from paper text for a specific image
   * Finds Figure/Fig references and extracts surrounding text
   */
  private extractImageContext(content: string, imageName: string): string {
    // Extract number from filename (e.g., "img-1.jpeg" -> "1")
    const numMatch = imageName.match(/(\d+)/);
    if (!numMatch) {
      return "";
    }

    const num = numMatch[1];
    const patterns = [
      new RegExp(`Figure\\s*${num}[^0-9]`, "gi"),
      new RegExp(`Fig\\.?\\s*${num}[^0-9]`, "gi"),
      new RegExp(`그림\\s*${num}[^0-9]`, "gi"),
    ];

    const lines = content.split("\n");
    const relevantChunks: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          // Get 2 lines before and 4 lines after
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 5);
          const chunk = lines.slice(start, end).join("\n").trim();
          if (chunk && !relevantChunks.includes(chunk)) {
            relevantChunks.push(chunk);
          }
          break;
        }
      }
    }

    if (relevantChunks.length > 0) {
      return relevantChunks.join("\n---\n");
    }

    return "(No direct text reference found)";
  }

  /**
   * Analyze a single image using Gemini multimodal API
   * Uses extracted context from paper text
   */
  private async analyzeImage(client: GeminiClient, image: ImageData & { name: string }, fullContent: string, metadata: Record<string, string> | null): Promise<string> {
    // Extract specific context for this image
    const imageContext = this.extractImageContext(fullContent, image.name);
    const titleContext = `Title: ${metadata?.title || 'Unknown'}`;

    const paperContext = imageContext !== "(No direct text reference found)"
      ? `${titleContext}\n\n## Text References to This Figure\n${imageContext}`
      : `${titleContext}\n\nAbstract/Content:\n${fullContent.slice(0, 1500)}`;

    const analysisPrompt = `You are an expert at analyzing academic paper figures.

Extract ALL details from this image and provide structured analysis:

## Visual Inventory
[List all visible elements: text, shapes, data points, colors, annotations]

## Core Findings
[3-5 key takeaways]

## Detailed Analysis
[Paragraph explaining the image comprehensively]

## Connection to Paper
[How this supports the paper's argument based on the provided context]

## Technical Details
[Numbers, dimensions, hyperparameters extracted]

Output in structured markdown.`;

    const result = await client.analyzeImage(
      { mimeType: image.mimeType, data: image.data },
      paperContext,
      analysisPrompt
    );

    if (result.success && result.data) {
      return result.data;
    }
    return "(분석 실패)";
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
