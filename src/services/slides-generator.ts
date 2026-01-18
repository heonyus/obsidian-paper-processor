import { App, TFile } from "obsidian";
import { GeminiClient, showError, showSuccess } from "../utils/api-client";
import type { PaperProcessorSettings } from "../settings";

export interface SlidesResult {
  success: boolean;
  htmlPath?: string;
  jsonPath?: string;
  error?: string;
}

export interface SlidesProgress {
  stage: "analyzing" | "generating" | "rendering" | "saving" | "complete";
  message: string;
  percent: number;
}

interface SlideData {
  title: string;
  subtitle?: string;
  content: string[];
  notes?: string;
  layout: "title" | "content" | "two-column" | "image" | "conclusion";
}

// Slide generation prompt
const SLIDES_PROMPT = (count: number, template: string) => `You are creating a ${count}-slide academic presentation.

TEMPLATE STYLE: ${template}
- academic: Clean, formal, minimal colors, focus on content
- minimal: Simple black & white, maximum whitespace
- modern: Colorful accents, dynamic layouts, visual emphasis

OUTPUT FORMAT (JSON array):
[
  {
    "title": "Slide Title",
    "subtitle": "Optional subtitle",
    "content": ["Bullet point 1", "Bullet point 2", "Bullet point 3"],
    "notes": "Speaker notes for this slide",
    "layout": "title|content|two-column|image|conclusion"
  }
]

SLIDE STRUCTURE for ${count} slides:
1. Title slide (layout: "title")
2. Problem/Motivation (layout: "content")
${count >= 4 ? "3. Background/Related Work (layout: \"content\")" : ""}
${count >= 5 ? "4. Proposed Method - Overview (layout: \"content\")" : ""}
${count >= 6 ? "5. Method Details (layout: \"two-column\")" : ""}
${count >= 7 ? "6. Experiments Setup (layout: \"content\")" : ""}
${count >= 8 ? "7. Results - Main (layout: \"content\")" : ""}
${count >= 9 ? "8. Results - Analysis (layout: \"content\")" : ""}
${count >= 5 ? `${count - 1}. Key Takeaways (layout: "content")` : ""}
${count}. Conclusion (layout: "conclusion")

RULES:
- Maximum 5 bullet points per slide
- Each bullet: 10-15 words max
- Include specific numbers/metrics where available
- Reference figures if relevant: "[See Fig. X]"
- Speaker notes should be 2-3 sentences

Return JSON array only, no markdown code blocks.`;

// HTML template for slides
const HTML_TEMPLATE = (slides: SlideData[], title: string, template: string) => {
  const colors = {
    academic: { primary: "#1a365d", secondary: "#2c5282", bg: "#ffffff", text: "#1a202c" },
    minimal: { primary: "#000000", secondary: "#4a5568", bg: "#ffffff", text: "#000000" },
    modern: { primary: "#6366f1", secondary: "#8b5cf6", bg: "#0f172a", text: "#f8fafc" },
  };

  const c = colors[template as keyof typeof colors] || colors.academic;

  const slideHtml = slides.map((slide, i) => `
    <section class="slide ${slide.layout}" data-index="${i}">
      <div class="slide-content">
        <h2>${slide.title}</h2>
        ${slide.subtitle ? `<h3 class="subtitle">${slide.subtitle}</h3>` : ""}
        <ul>
          ${slide.content.map((item) => `<li>${item}</li>`).join("\n          ")}
        </ul>
      </div>
      ${slide.notes ? `<aside class="notes">${slide.notes}</aside>` : ""}
    </section>
  `).join("\n");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Slides</title>
  <style>
    :root {
      --primary: ${c.primary};
      --secondary: ${c.secondary};
      --bg: ${c.bg};
      --text: ${c.text};
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }

    .slides-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }

    .slide {
      background: var(--bg);
      border: 1px solid var(--primary);
      border-radius: 8px;
      padding: 3rem;
      margin-bottom: 2rem;
      min-height: 400px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      page-break-after: always;
    }

    .slide.title {
      text-align: center;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      color: white;
    }

    .slide.title h2 {
      font-size: 2.5rem;
      margin-bottom: 1rem;
    }

    .slide.conclusion {
      background: var(--primary);
      color: white;
    }

    h2 {
      font-size: 1.8rem;
      color: var(--primary);
      margin-bottom: 1.5rem;
      border-bottom: 2px solid var(--secondary);
      padding-bottom: 0.5rem;
    }

    .slide.title h2,
    .slide.conclusion h2 {
      color: white;
      border-bottom-color: rgba(255,255,255,0.3);
    }

    .subtitle {
      font-size: 1.2rem;
      color: var(--secondary);
      font-weight: normal;
      margin-bottom: 1rem;
    }

    ul {
      list-style: none;
      padding-left: 0;
    }

    li {
      position: relative;
      padding-left: 1.5rem;
      margin-bottom: 1rem;
      font-size: 1.1rem;
    }

    li::before {
      content: "▸";
      position: absolute;
      left: 0;
      color: var(--secondary);
    }

    .slide.title li::before,
    .slide.conclusion li::before {
      color: rgba(255,255,255,0.7);
    }

    .notes {
      display: none;
    }

    .slide-nav {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      display: flex;
      gap: 0.5rem;
    }

    .slide-nav button {
      padding: 0.5rem 1rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    .slide-nav button:hover {
      background: var(--secondary);
    }

    @media print {
      .slide-nav { display: none; }
      .slide {
        page-break-after: always;
        border: none;
        min-height: 100vh;
      }
    }

    /* Presentation mode */
    body.presentation-mode .slides-container {
      max-width: 100%;
      padding: 0;
    }

    body.presentation-mode .slide {
      min-height: 100vh;
      margin: 0;
      border-radius: 0;
      border: none;
    }

    body.presentation-mode .slide:not(.active) {
      display: none;
    }
  </style>
</head>
<body>
  <div class="slides-container">
    ${slideHtml}
  </div>

  <div class="slide-nav">
    <button onclick="prevSlide()">← Prev</button>
    <button onclick="nextSlide()">Next →</button>
    <button onclick="togglePresentation()">🖥️ Present</button>
  </div>

  <script>
    let currentSlide = 0;
    const slides = document.querySelectorAll('.slide');

    function showSlide(index) {
      slides.forEach((s, i) => {
        s.classList.toggle('active', i === index);
      });
      currentSlide = index;
    }

    function nextSlide() {
      if (currentSlide < slides.length - 1) showSlide(currentSlide + 1);
    }

    function prevSlide() {
      if (currentSlide > 0) showSlide(currentSlide - 1);
    }

    function togglePresentation() {
      document.body.classList.toggle('presentation-mode');
      if (document.body.classList.contains('presentation-mode')) {
        showSlide(0);
      }
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') nextSlide();
      if (e.key === 'ArrowLeft') prevSlide();
      if (e.key === 'Escape') document.body.classList.remove('presentation-mode');
    });
  </script>
</body>
</html>`;
};

/**
 * Slides Generator Service
 */
export class SlidesGeneratorService {
  private app: App;
  private settings: PaperProcessorSettings;
  private onProgress?: (progress: SlidesProgress) => void;

  constructor(app: App, settings: PaperProcessorSettings) {
    this.app = app;
    this.settings = settings;
  }

  setProgressCallback(callback: (progress: SlidesProgress) => void): void {
    this.onProgress = callback;
  }

  private updateProgress(stage: SlidesProgress["stage"], message: string, percent: number): void {
    if (this.onProgress) {
      this.onProgress({ stage, message, percent });
    }
  }

  /**
   * Generate slides from a paper
   */
  async generate(paperFolder: string): Promise<SlidesResult> {
    if (!this.settings.geminiApiKey) {
      return {
        success: false,
        error: "Gemini API key not configured. Please set it in plugin settings.",
      };
    }

    try {
      this.updateProgress("analyzing", "Reading paper content...", 10);

      // Get paper content
      const content = await this.getPaperContent(paperFolder);
      if (!content) {
        return {
          success: false,
          error: "No paper content found. Run OCR or provide markdown files.",
        };
      }

      const metadata = await this.getMetadata(paperFolder);
      const title = metadata?.title || "Untitled Paper";

      this.updateProgress("generating", `Generating ${this.settings.slideCount} slides...`, 30);

      // Build prompt
      const prompt = `${SLIDES_PROMPT(this.settings.slideCount, this.settings.slideTemplate)}

---
PAPER TITLE: ${title}
---

PAPER CONTENT:
${content.substring(0, 15000)} ${content.length > 15000 ? "... [truncated]" : ""}

Generate the slide data now.`;

      // Call Gemini
      const client = new GeminiClient(this.settings.geminiApiKey, this.settings.slidesModel);
      const result = await client.generateContent(prompt, {
        temperature: 0.7,
        maxOutputTokens: 4096,
      });

      if (!result.success || !result.data) {
        return {
          success: false,
          error: result.error || "Slides generation failed",
        };
      }

      this.updateProgress("rendering", "Rendering HTML slides...", 60);

      // Parse slide data
      let slidesData: SlideData[];
      try {
        let jsonStr = result.data;
        if (jsonStr.startsWith("```")) {
          jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```$/g, "").trim();
        }
        slidesData = JSON.parse(jsonStr);
      } catch {
        return {
          success: false,
          error: "Failed to parse slide data from AI response",
        };
      }

      this.updateProgress("saving", "Saving slides...", 80);

      // Generate HTML
      const html = HTML_TEMPLATE(slidesData, title, this.settings.slideTemplate);

      // Save files
      const htmlPath = `${paperFolder}/slides.html`;
      const jsonPath = `${paperFolder}/slides.json`;

      await this.saveFile(htmlPath, html);
      await this.saveFile(jsonPath, JSON.stringify(slidesData, null, 2));

      this.updateProgress("complete", "Slides generated!", 100);
      showSuccess(`Generated ${slidesData.length} slides`);

      return {
        success: true,
        htmlPath,
        jsonPath,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      showError(errorMessage);
      return { success: false, error: errorMessage };
    }
  }

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

  private async saveFile(path: string, content: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }
}
