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

// Critical image description instructions
const IMAGE_DESCRIPTION_INSTRUCTIONS = `
## 이미지 해설 규칙 (매우 중요!)

**모든 이미지는 반드시 15-20줄 이상의 상세한 해설 필수:**

각 이미지 바로 아래에 다음 내용을 포함하여 작성:

1. **전체 구조/흐름 개요** (2-3줄)
   - 이미지가 논문의 어떤 부분을 시각화하는지
   - 전체적인 데이터/정보의 흐름 방향

2. **각 블록/컴포넌트의 상세 설명** (5-7줄)
   - 각 박스, 화살표, 색상의 의미
   - **논문 본문에서 언급된 정확한 표현 인용**
   - 수학적 표기법이 있다면 LaTeX로 명시 (예: $W_Q$, $W_K$, $W_V$)

3. **입력→처리→출력 단계별 설명** (3-4줄)
   - 입력 데이터의 형태/차원 (예: "[batch, seq_len, d_model]")
   - 중간 처리 과정의 수학적 연산
   - 출력의 형태와 의미

4. **핵심 기술적 세부사항** (3-4줄)
   - 논문에서 언급된 하이퍼파라미터
   - 계산 복잡도나 효율성 관련 언급
   - 다른 방법론과의 차이점

5. **수치/실험 결과** (2-3줄, 해당시)
   - 그래프/표에서 읽을 수 있는 구체적 수치
   - 베이스라인 대비 성능 향상 (예: "+5.2 F1", "-23% latency")

**마크다운 포맷 적극 활용:**
- 번호 매기기: \`1. 첫 번째 컴포넌트\`, \`2. 두 번째 컴포넌트\`
- 불릿: \`- 서브 항목\`, \`* 중요 포인트\`
- **볼드**: 중요 용어나 수치 강조 (\`**Query Encoder**\`, \`**768차원**\`)
- 수식: 인라인 \`$...$\`, 블록 \`$$...$$\`

**예시:**
![[images/fig1.png]]

그림 1은 제안된 Token Routing 아키텍처의 전체 구조를 보여준다.

**1. Query Encoder (왼쪽 파란 박스)**
- 입력 텍스트를 **768차원 임베딩**으로 변환
- BERT-base 아키텍처 사용 (논문 Section 3.1)
- 입력: 텍스트 쿼리 (최대 512 토큰)
- 출력: $\\mathbf{q} \\in \\mathbb{R}^{768}$

**2. Routing Module (중앙 블록)**
- 학습 가능한 가중치 행렬 $W_q \\in \\mathbb{R}^{128 \\times 768}$
- 라우팅 점수 계산: $\\mathbf{s} = W_q \\mathbf{q}$
- 소프트맥스 정규화 후 상위 $k=16$개 토큰 선택
- 논문에서 "query-conditional token selection"으로 명명

**3. Retrieval Head (오른쪽 블록)**
- 선택된 16개 토큰을 연결하여 문서 인코더와 내적
- 점선 화살표는 역전파 경로 (end-to-end 학습)
- 계산량 **87.5% 감소** (128→16 토큰)

**실험 결과**: MS MARCO 데이터셋에서 F1 87.3 달성, 지연시간 12ms (기존 42ms 대비 71% 감소)
`;

// Blog generation prompts by style
const BLOG_PROMPTS: Record<string, string> = {
  technical: `당신은 AI/ML 논문을 해설하는 전문 테크니컬 블로그 저자입니다.

## 목표
논문의 핵심을 완전히 이해하고, 독자가 논문을 읽지 않아도 핵심 내용과 의의를 파악할 수 있도록
**깊이 있고 구체적인** 문서를 작성하세요.

## 섹션 구조 (필수 순서)

### 1. 문제정의 (3-5 문단)
- 기존 시스템/방법론의 한계를 **구체적 수치/사례**로 제시
- 왜 이 문제가 중요한지, 해결하지 못하면 어떤 실무적 문제가 발생하는지
- 본 논문이 해결하려는 핵심 질문

### 2. 관련연구 (2-4 문단)
- 각 선행 연구의 핵심 아이디어와 **한계를 명확히 대조**
- 본 논문과의 차별점을 구체적으로 강조
- 표로 정리 가능하면 적극 활용

### 3. 방법 (5-10 문단, 가장 중요!)
- **입력→처리→출력 흐름**을 단계별로 분해하여 설명
- 하위 섹션 활용: ### 3.1, ### 3.2 등
- **모든 수식은 반드시 LaTeX + 상세 설명**:
  - 수식 바로 아래 3-5줄로 각 변수 의미, 입출력 차원, 계산 목적 설명
- **모든 이미지는 반드시 15-20줄 상세 해설** (아래 규칙 참조)

### 4. 실험 (4-6 문단)
- 실험 설정: 데이터셋, 베이스라인, 평가 지표, 하이퍼파라미터
- **모든 표/그래프 상세 해설**: 비교 대상, 최고 결과, 마진, 실무적 의미
- Ablation Study 결과와 컴포넌트별 기여도 분석

### 5. 결론 (2-3 문단)
- 핵심 기여 3-4개 항목으로 정리
- 수치적 성과 재강조
- 한계점 솔직하게 기술

### 6. 인사이트 (2-4 문단)
- 기술적 인사이트: 왜 이 방법이 작동하는가?
- 실무적 함의: 어떤 시스템/서비스에 적용 가능한가?
- 향후 연구 방향
${IMAGE_DESCRIPTION_INSTRUCTIONS}
${OBSIDIAN_FORMAT_INSTRUCTIONS}

## 추가 규칙
- 제공된 자료 밖의 내용 추측 금지
- 문체: 한국어, 전문 블로그 스타일 (단정적이고 명확하게)
- 각 섹션은 최소 200자 이상 (피상적인 요약 금지)`,

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
${IMAGE_DESCRIPTION_INSTRUCTIONS}
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
