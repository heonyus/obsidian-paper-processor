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

// Markdown formatting rules - CRITICAL
const MARKDOWN_FORMATTING_RULES = `
## 마크다운 포맷팅 규칙 (필수 준수!)

**1. 불릿 포인트 적극 활용 (MUST)**
모든 섹션에서 불릿 포인트를 적극적으로 사용하세요:

- 3개 이상 나열되는 항목은 반드시 불릿으로
- 단계별 설명은 번호 매기기 (1., 2., 3.)
- 하위 항목은 들여쓰기 불릿 (  - 또는   *)
- 대조/비교는 불릿으로 병렬 구조

**2. 계층 구조 표현**
\`\`\`markdown
- **상위 개념**
  - 하위 설명 1
  - 하위 설명 2
    - 세부 사항 a
    - 세부 사항 b
\`\`\`

**3. 볼드/이탤릭 사용**
- **핵심 용어**, **수치**, **모델명**은 반드시 볼드
- *강조하고 싶은 부연 설명*은 이탤릭
- \`코드\`, \`하이퍼파라미터명\`, \`데이터셋명\`은 인라인 코드

**4. 수식 표현**
- 인라인 수식: $x = W_q \\cdot h$
- 블록 수식 (중요 수식):
$$
\\mathcal{L} = \\sum_{i=1}^{N} -\\log p(y_i | x_i)
$$

**5. 표 사용 (비교/실험 결과)**
| Method | F1 | Latency |
|--------|-----|---------|
| Baseline | 82.3 | 45ms |
| **Ours** | **87.3** | **12ms** |

**6. 콜아웃 박스**
> [!note] 핵심 포인트
> 이 방법의 핵심은 query-conditional selection이다.

> [!tip] 실무 적용
> 대규모 검색 시스템에 적용 시 지연시간 71% 감소 기대.
`;

// Critical image description instructions
const IMAGE_DESCRIPTION_INSTRUCTIONS = `
## 이미지 해설 규칙 (절대 필수 - 이 규칙을 어기면 안 됨!)

**⚠️ 경고: 모든 이미지는 반드시 20-30줄 이상의 학술적 해설이 필요합니다.**
**짧은 설명(10줄 미만)은 절대 허용되지 않습니다.**

### 필수 구조 (모든 이미지에 적용)

각 이미지 바로 아래에 다음 5개 섹션을 **불릿 포인트로** 작성:

#### 섹션 1: 전체 구조 개요 (3-4줄)
- 이 그림이 논문의 어떤 섹션/개념을 시각화하는지 명시
- 전체적인 데이터/정보의 흐름 방향 (왼쪽→오른쪽, 위→아래 등)
- 주요 컴포넌트 개수와 역할 요약

#### 섹션 2: 컴포넌트별 상세 설명 (8-10줄)
각 블록/모듈마다 **볼드 제목 + 불릿 리스트**:

**[컴포넌트 A 이름] (위치 설명)**
- 역할: 무엇을 하는 모듈인지
- 입력: 어떤 형태의 데이터가 들어오는지 (차원 포함)
- 처리: 내부에서 어떤 연산이 일어나는지
- 출력: 어떤 형태로 나가는지
- 수식: 해당되면 LaTeX로 $W_q \\in \\mathbb{R}^{d \\times k}$

**[컴포넌트 B 이름] (위치 설명)**
- 역할: ...
- 입력: ...
- (동일 구조 반복)

#### 섹션 3: 데이터 흐름 단계별 설명 (4-5줄)
1. **입력 단계**: 원본 데이터 형태, 전처리 과정
2. **인코딩 단계**: 임베딩 변환, 차원 변화
3. **핵심 처리 단계**: 논문의 핵심 contribution이 적용되는 부분
4. **출력 단계**: 최종 결과물의 형태와 의미

#### 섹션 4: 기술적 세부사항 (4-5줄)
- **하이퍼파라미터**: \`hidden_dim=768\`, \`num_layers=12\` 등
- **계산 복잡도**: $O(n^2)$ → $O(n \\log n)$ 개선
- **메모리 사용량**: 기존 대비 몇 % 감소
- **학습 설정**: optimizer, learning rate, batch size

#### 섹션 5: 실험 결과 연계 (3-4줄, 표/그래프인 경우)
- **베이스라인 대비 성능**: +5.2 F1, -23% latency
- **최고 성능 달성 조건**: 어떤 설정에서 최고인지
- **Ablation 결과**: 어떤 컴포넌트가 가장 중요한지

---

### 예시 (이 수준의 상세함 필수):

![[images/img-1.png]]

**그림 1: Token Routing 아키텍처의 전체 구조**

이 그림은 논문 Section 3에서 제안하는 Token Routing 메커니즘의 전체 파이프라인을 보여준다. 데이터는 왼쪽에서 오른쪽으로 흐르며, 크게 3개의 주요 모듈(Query Encoder, Routing Module, Retrieval Head)로 구성된다.

**1. Query Encoder (왼쪽 파란 박스)**
- **역할**: 입력 텍스트를 dense embedding으로 변환
- **아키텍처**: BERT-base (\`12 layers\`, \`hidden_dim=768\`)
- **입력**: 텍스트 쿼리, 최대 512 토큰
- **출력**: $\\mathbf{q} \\in \\mathbb{R}^{768}$
- **특징**: pretrained weights 사용, fine-tuning 가능

**2. Routing Module (중앙 주황색 블록)**
- **역할**: query-conditional하게 중요 토큰 선택
- **핵심 수식**: 라우팅 점수 $\\mathbf{s} = \\text{softmax}(W_r \\cdot \\mathbf{q})$
  - $W_r \\in \\mathbb{R}^{V \\times 768}$: 학습 가능한 라우팅 행렬
  - $V$: vocabulary size
- **Top-k 선택**: 상위 $k=16$개 토큰만 선택 (논문 Table 2에서 최적값)
- **장점**: 계산량 **87.5% 감소** (128→16 토큰)

**3. Retrieval Head (오른쪽 녹색 블록)**
- **역할**: 선택된 토큰으로 문서 유사도 계산
- **연산**: 선택된 16개 토큰 임베딩과 문서 인코더 출력의 내적
- **점선 화살표**: 역전파 경로 (end-to-end 학습 지원)
- **출력**: relevance score $\\in [0, 1]$

**데이터 흐름 요약**:
1. Query 텍스트 → BERT 인코딩 → 768차원 벡터
2. 라우팅 점수 계산 → Top-16 토큰 인덱스 추출
3. 선택된 토큰만으로 경량화된 retrieval 수행
4. 최종 유사도 점수 출력

**실험 결과 (Table 1 참조)**:
- MS MARCO: **F1 87.3** (baseline 82.3 대비 +5.0)
- 지연시간: **12ms** (기존 42ms 대비 71% 감소)
- 메모리: **2.3GB** (기존 8.1GB 대비 72% 감소)

---

⚠️ **위 예시처럼 모든 이미지를 20줄 이상으로 상세하게 설명해야 합니다!**
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
${MARKDOWN_FORMATTING_RULES}
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

      // Build system prompt with image instructions
      const imageInstructions = images.length > 0 ? `

## IMAGES INFORMATION
You will receive ${images.length} images with their analysis.
- Each image is labeled as "IMAGE N: images/filename"
- The analysis is provided right before each image
- You MUST include ALL images in your blog post using Obsidian embed syntax: ![[images/filename]]
- For each image, write 20-30 lines of detailed explanation based on the analysis AND the actual image
- Place images in appropriate sections (architecture in Method, results in Experiment, etc.)
` : "";

      const systemPrompt = `${stylePrompt}

${langInstruction}
${imageInstructions}

---
PAPER TITLE: ${metadata?.title || "Unknown"}
${metadata?.title_ko ? `KOREAN TITLE: ${metadata.title_ko}` : ""}
---`;

      // Call Gemini with interleaved images (Multimodal)
      const client = new GeminiClient(this.settings.geminiApiKey, this.settings.blogModel);
      this.updateProgress("generating", `📝 Using interleaved multimodal API with ${images.length} images`, 65);

      const startTime = Date.now();

      // Use interleaved multimodal API if we have images
      let result;
      if (images.length > 0) {
        // Prepare interleaved format: image label + analysis + actual image
        const imagesWithAnalysis = images.map(img => ({
          image: { mimeType: img.mimeType, data: img.data },
          label: img.relativePath,
          analysis: img.analysis || "(분석 없음)",
        }));

        result = await client.generateContentWithInterleavedImages(
          systemPrompt,
          imagesWithAnalysis,
          content,
          {
            temperature: 0.7,
            maxOutputTokens: 8192,
          }
        );
      } else {
        const fullPrompt = `${systemPrompt}\n\nPAPER CONTENT:\n${content}\n\n---\nGenerate the blog post now. Output markdown only, no explanations.`;
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
