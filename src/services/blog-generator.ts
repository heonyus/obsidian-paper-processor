import { App, TFile, TFolder } from "obsidian";
import { GeminiClient, OpenAICompatibleClient, ImageData, showError, showSuccess } from "../utils/api-client";
import type { PaperProcessorSettings } from "../settings";
import { arxivCategoriesToTags, extractTopicTags } from "../utils/obsidian-format";
import { getUsageTracker } from "./usage-tracker";
import { getProviderFromModel } from "../utils/pricing-table";

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

// ============================================================================
// IMAGE TRIAGE PROMPT - Classify images into Tier 1/2/3
// ============================================================================
const TRIAGE_PROMPT = `You are a Senior Editor at a top-tier AI conference.
Your task is to categorize the importance of the provided images based on the paper's Abstract and Title.
We need to decide which images deserve "Deep Inspection" vs "Quick Summary".

## Categories
- **TIER 1 (Critical)**: The core architecture diagram, the main performance table, or the key conceptual figure. (Max 2-3 images)
- **TIER 2 (Supporting)**: Ablation studies, case study examples, secondary charts.
- **TIER 3 (Minor)**: Hyperparameter tables, appendix figures, generic logos/placeholders, simple diagrams.

## Output Format (JSON Only)
Return a JSON array only, no other text:
[
  { "filename": "img-1.jpeg", "tier": 1, "reason": "Main architecture diagram", "section": "방법" },
  { "filename": "img-2.jpeg", "tier": 2, "reason": "Performance comparison table", "section": "실험" },
  ...
]

section must be one of: "문제정의", "관련연구", "방법", "실험", "결론", "인사이트"
`;

// ============================================================================
// SECTION-SPECIFIC PROMPTS
// ============================================================================
const SECTION_PROMPTS: Record<string, string> = {
  문제정의: `당신은 AI/ML 논문의 문제정의 섹션을 작성하는 전문가입니다.

## 목표
독자가 왜 이 논문이 중요한지, 어떤 문제를 해결하려는지 완전히 이해하도록 작성하세요.

## 작성 가이드
- **3-5개 문단**으로 구성
- 첫 문단: 기존 시스템/방법론의 한계를 구체적 수치/사례로 제시
- 중간 문단: 왜 이 문제가 중요한지, 실무적 영향
- 마지막 문단: 본 논문이 해결하려는 핵심 질문을 명확히 정리
- **불릿 포인트 적극 활용**

## 출력 형식
마크다운 형식으로 작성 (섹션 제목 \`## 문제정의\` 포함)
`,

  관련연구: `당신은 AI/ML 논문의 관련연구 섹션을 작성하는 전문가입니다.

## 목표
선행 연구들의 아이디어와 한계를 명확히 대조하고, 본 논문의 차별점을 강조하세요.

## 작성 가이드
- **2-4개 문단**으로 구성
- 각 선행 연구의 핵심 아이디어 + 한계점 명확히 기술
- 본 논문과의 차별점 구체적으로 강조
- 표로 정리 가능하면 적극 활용
- [[wikilinks]]로 주요 개념 연결

## 컨텍스트
이전 섹션 내용:
{previous_sections}

## 출력 형식
마크다운 형식으로 작성 (섹션 제목 \`## 관련연구\` 포함)
`,

  방법: `당신은 AI/ML 논문의 방법론 섹션을 작성하는 전문가입니다.

## 목표
제안하는 방법의 입력→처리→출력 흐름을 완벽하게 이해시키세요.

## 작성 가이드 (가장 중요한 섹션!)
- **5-10개 문단**으로 구성
- **입력→처리→출력** 흐름을 단계별로 분해
- 하위 섹션 활용 권장 (### 3.1, ### 3.2 등)
- **모든 수식 해설 필수**:
  - 수식 바로 아래 3-5줄로 변수 의미, 차원, 목적 설명
  - 인라인: $x = W_q \\cdot h$
  - 블록: $$\\mathcal{L} = \\sum_{i=1}^{N} -\\log p(y_i | x_i)$$
- **모든 이미지 해설 필수** (20-30줄):
  1) 전체 구조/흐름
  2) 각 블록/화살표 의미
  3) 입력 데이터 변환 과정
  4) 핵심 컴포넌트와 역할
  5) 수식과의 연계

## 제공된 이미지
{images_info}

## 컨텍스트
이전 섹션 내용:
{previous_sections}

## 출력 형식
마크다운 형식으로 작성 (섹션 제목 \`## 방법\` 포함)
이미지는 \`![[images/파일명]]\` 형식으로 삽입
`,

  실험: `당신은 AI/ML 논문의 실험 섹션을 작성하는 전문가입니다.

## 목표
실험 설정, 결과, 분석을 명확하고 설득력 있게 제시하세요.

## 작성 가이드
- **4-6개 문단**으로 구성
- 실험 설정 명확히: 데이터셋, 베이스라인, 지표, 하이퍼파라미터
- **모든 표/그래프 해설 필수** (15-20줄):
  1) 비교 대상
  2) 최고 결과와 마진 (**볼드** 강조)
  3) 예상 밖의 결과 해석
  4) 실무적 의미
- Ablation Study 포함하여 컴포넌트별 기여도 분석
- 표 형식 적극 활용:
  | Method | F1 | Latency |
  |--------|-----|---------|
  | Baseline | 82.3 | 45ms |
  | **Ours** | **87.3** | **12ms** |

## 제공된 이미지
{images_info}

## 컨텍스트
이전 섹션 내용:
{previous_sections}

## 출력 형식
마크다운 형식으로 작성 (섹션 제목 \`## 실험\` 포함)
`,

  결론: `당신은 AI/ML 논문의 결론 섹션을 작성하는 전문가입니다.

## 목표
논문의 핵심 기여와 한계를 간결하게 정리하세요.

## 작성 가이드
- **2-3개 문단**으로 구성
- 핵심 기여 3-4개 항목으로 정리 (불릿 포인트)
- 수치적 성과 다시 강조 (**볼드**)
- 한계점 솔직하게 기술
- Callout 활용:
  > [!tip] 핵심 기여
  > 1. ...
  > 2. ...

## 컨텍스트
이전 섹션 내용:
{previous_sections}

## 출력 형식
마크다운 형식으로 작성 (섹션 제목 \`## 결론\` 포함)
`,

  인사이트: `당신은 AI/ML 논문의 인사이트 섹션을 작성하는 전문가입니다.

## 목표
논문의 의의와 향후 방향을 깊이 있게 분석하세요.

## 작성 가이드
- **2-4개 문단**으로 구성
- 기술적 인사이트: 왜 이 방법이 작동하는가?
- 실무적 함의: 어떤 시스템에 적용 가능한가?
- 향후 연구 방향: 열어놓은 새로운 질문들
- 개인적 평가: 인상적인 점, 아쉬운 점
- [[wikilinks]]로 관련 개념 연결
- #tags 활용 (예: #attention-mechanism, #efficiency)

## 컨텍스트
전체 블로그 내용:
{previous_sections}

## 출력 형식
마크다운 형식으로 작성 (섹션 제목 \`## 인사이트\` 포함)

마지막에 "## Related Concepts" 섹션 추가:
## Related Concepts
- [[Concept1]]
- [[Concept2]]
...
`,
};

// Section order for sequential generation
const SECTION_ORDER = ["문제정의", "관련연구", "방법", "실험", "결론", "인사이트"];

// Section to source mapping
const SECTION_SOURCE_KEYS: Record<string, string[]> = {
  문제정의: ["introduction", "abstract", "intro"],
  관련연구: ["related", "background", "prior"],
  방법: ["method", "approach", "model", "architecture"],
  실험: ["experiment", "result", "evaluation"],
  결론: ["conclusion", "discussion", "summary"],
  인사이트: [], // Uses full context
};

// Language instructions
const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  ko: "Write the entire section in Korean (한국어). Use natural Korean expressions suitable for a technical blog.",
  en: "Write the entire section in English.",
  bilingual: `Write with:
- Main content in Korean (한국어)
- Technical terms as "English(한국어)" format`,
};

// ============================================================================
// IMAGE DATA TYPES
// ============================================================================
interface ImageAsset extends ImageData {
  name: string;
  relativePath: string;
  tier?: number;
  section?: string;
  reason?: string;
  analysis?: string;
}

// ============================================================================
// BLOG GENERATOR SERVICE
// ============================================================================
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
   * Create an OpenAI-compatible client for non-Gemini models
   */
  private createTextClient(): OpenAICompatibleClient {
    const model = this.settings.blogModel;
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
    } else if (model.startsWith("deepseek-") && !model.includes("distill")) {
      baseUrl = "https://api.deepseek.com/v1";
      apiKey = this.settings.deepseekApiKey;
    } else if (model.startsWith("llama-") || model.includes("distill")) {
      // Groq models
      baseUrl = "https://api.groq.com/openai/v1";
      apiKey = this.settings.groqApiKey;
    } else {
      // Default to Gemini via OpenAI-compatible mode (not used, but fallback)
      baseUrl = "https://generativelanguage.googleapis.com/v1beta";
      apiKey = this.settings.geminiApiKey;
    }

    console.debug(`[BlogGenerator] Model: ${model}, API: ${baseUrl}`);
    return new OpenAICompatibleClient(baseUrl, apiKey, model);
  }

  /**
   * Check if the current model is a Gemini model (supports multimodal)
   */
  private isGeminiModel(): boolean {
    return this.settings.blogModel.startsWith("gemini-");
  }

  /**
   * Generate a blog post using sequential section generation
   */
  async generate(paperFolder: string): Promise<BlogResult> {
    const model = this.settings.blogModel;
    const apiKeyError = this.checkApiKey(model);
    if (apiKeyError) {
      return {
        success: false,
        error: apiKeyError,
      };
    }

    const isGemini = this.isGeminiModel();

    try {
      this.updateProgress("analyzing", `📂 Reading from folder: ${paperFolder}`, 2);

      // 1. Load paper content
      const content = await this.getPaperContent(paperFolder);
      if (!content) {
        return { success: false, error: "No paper content found." };
      }
      const wordCount = content.split(/\s+/).length;
      this.updateProgress("analyzing", `📄 Paper loaded: ${wordCount.toLocaleString()} words`, 5);

      // 2. Load metadata
      const metadata = await this.getMetadata(paperFolder);
      const title = metadata?.title || "Unknown Paper";
      const titleKo = metadata?.title_ko || "";
      this.updateProgress("analyzing", `📋 Title: "${title}"`, 7);

      // 3. Load images (only used for Gemini multimodal)
      const images = await this.loadImagesWithData(paperFolder, 15);
      this.updateProgress("analyzing", `🖼️ Found ${images.length} images`, 10);

      // Create appropriate client based on model
      const geminiClient = isGemini ? new GeminiClient(this.settings.geminiApiKey, this.settings.blogModel) : null;
      const textClient = !isGemini ? this.createTextClient() : null;

      // 4. IMAGE TRIAGE - Classify images into Tier 1/2/3 (Gemini only)
      if (isGemini && geminiClient && images.length > 0) {
        this.updateProgress("analyzing", "🧩 Triaging images (Tier 1/2/3)...", 12);
        await this.triageImages(geminiClient, images, content);

        const tier1Count = images.filter(i => i.tier === 1).length;
        const tier2Count = images.filter(i => i.tier === 2).length;
        const tier3Count = images.filter(i => i.tier === 3).length;
        this.updateProgress("analyzing", `📊 Triage: Tier1=${tier1Count}, Tier2=${tier2Count}, Tier3=${tier3Count} (skipped)`, 15);

        // 5. Deep analyze only Tier 1 and Tier 2 images
        const imagesToAnalyze = images.filter(i => i.tier !== 3);
        this.updateProgress("analyzing", `🔍 Deep analyzing ${imagesToAnalyze.length} images (skipping Tier 3)...`, 18);

        for (let i = 0; i < imagesToAnalyze.length; i++) {
          const img = imagesToAnalyze[i];
          const tierLabel = img.tier === 1 ? "🌟 Tier 1" : "🔸 Tier 2";
          this.updateProgress("analyzing", `${tierLabel}: ${img.name}`, 18 + (i * 2));

          try {
            const analysis = await this.analyzeImage(geminiClient, img, content, metadata);
            img.analysis = analysis;
          } catch (err) {
            console.error(`Failed to analyze ${img.name}:`, err);
            img.analysis = "(분석 실패)";
          }
        }
        this.updateProgress("analyzing", `✅ Image analysis complete`, 40);
      } else if (!isGemini) {
        this.updateProgress("analyzing", `ℹ️ Skipping image analysis (non-Gemini model: ${model})`, 40);
      }

      // 6. Parse source sections
      this.updateProgress("generating", "📑 Parsing paper sections...", 42);
      const parsedSections = this.parseSections(content);

      // 7. SEQUENTIAL SECTION GENERATION with REAL-TIME SAVE
      this.updateProgress("generating", `🚀 Sequential generation (${SECTION_ORDER.length} sections)`, 45);

      const generatedSections: string[] = [];
      let accumulatedContext = "";
      const langInstruction = LANGUAGE_INSTRUCTIONS[this.settings.blogLanguage] || LANGUAGE_INSTRUCTIONS.ko;
      const blogPath = `${paperFolder}/blog.md`;
      const blogTitle = titleKo || title;
      const frontmatter = this.generateFrontmatter(metadata, content);

      // Create initial blog file for real-time viewing
      const initialContent = `${frontmatter}\n\n# ${blogTitle}: 논문 해설\n\n_블로그 생성 중... (${SECTION_ORDER.length}개 섹션)_\n\n---\n\n`;
      await this.saveFile(blogPath, initialContent);

      for (let i = 0; i < SECTION_ORDER.length; i++) {
        const sectionName = SECTION_ORDER[i];
        const progressBase = 45 + (i * 8);
        this.updateProgress("generating", `📝 [${i + 1}/${SECTION_ORDER.length}] ${sectionName} 생성 중...`, progressBase);

        // Get images assigned to this section
        const sectionImages = images.filter(img => img.section === sectionName && img.tier !== 3);

        // Get relevant source content
        const sourceKeys = SECTION_SOURCE_KEYS[sectionName];
        let sourceContent = "";
        if (sourceKeys.length > 0) {
          for (const key of sourceKeys) {
            const matched = Object.entries(parsedSections).find(([k]) =>
              k.toLowerCase().includes(key)
            );
            if (matched) {
              sourceContent += matched[1] + "\n\n";
            }
          }
        }
        if (!sourceContent) {
          sourceContent = content.slice(0, 8000); // fallback
        }

        // Generate section (different path for Gemini vs other models)
        let sectionText: string;
        if (isGemini && geminiClient) {
          sectionText = await this.generateSectionGemini(
            geminiClient,
            sectionName,
            sourceContent,
            { title, title_ko: titleKo },
            accumulatedContext,
            sectionImages,
            langInstruction
          );
        } else if (textClient) {
          sectionText = await this.generateSectionText(
            textClient,
            sectionName,
            sourceContent,
            { title, title_ko: titleKo },
            accumulatedContext,
            images, // Pass all images for reference text only
            langInstruction
          );
        } else {
          sectionText = `## ${sectionName}\n\n(클라이언트 생성 실패)`;
        }

        generatedSections.push(sectionText);
        accumulatedContext += `\n\n${sectionText}`;

        // 🔥 REAL-TIME SAVE: Update blog file after each section
        const remainingSections = SECTION_ORDER.slice(i + 1);
        const progressNote = remainingSections.length > 0
          ? `\n\n---\n\n_생성 중: ${remainingSections.join(", ")} 남음..._`
          : "";
        const currentBlogContent = `${frontmatter}\n\n# ${blogTitle}: 논문 해설\n\n${generatedSections.join("\n\n")}${progressNote}`;
        await this.saveFile(blogPath, currentBlogContent);

        this.updateProgress("generating", `✅ ${sectionName} 완료`, progressBase + 5);
      }

      // 8. Final save (clean version without progress note)
      this.updateProgress("saving", "🎨 Finalizing blog...", 95);
      const finalContent = `${frontmatter}\n\n# ${blogTitle}: 논문 해설\n\n${generatedSections.join("\n\n")}`;
      await this.saveFile(blogPath, finalContent);

      const finalWordCount = finalContent.split(/\s+/).length;
      this.updateProgress("complete", `✅ 블로그 생성 완료! (${finalWordCount.toLocaleString()} 단어)`, 100);
      showSuccess("Blog post generated successfully");

      return { success: true, content: finalContent, path: blogPath };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      showError(errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Triage images into Tier 1/2/3 and assign to sections
   */
  private async triageImages(client: GeminiClient, images: ImageAsset[], content: string): Promise<void> {
    // Extract abstract/intro for context
    const introMatch = content.match(/(#+ Abstract[\s\S]*?)(?=\n#+ \w)/i);
    const context = introMatch ? introMatch[1] : content.slice(0, 3000);

    const imageNames = images.map(i => i.name).join("\n");
    const userMsg = `Paper Content (Abstract):\n${context}\n\nImage List:\n${imageNames}`;
    const usageTracker = getUsageTracker();
    const model = this.settings.blogModel;
    const provider = getProviderFromModel(model);

    try {
      const result = await client.generateContent(
        `${TRIAGE_PROMPT}\n\n${userMsg}`,
        { temperature: 0.2, maxOutputTokens: 2048 }
      );

      // Record usage if available
      if (result.usage) {
        usageTracker.recordUsage({
          provider,
          model,
          feature: "blog",
          usage: result.usage,
        });
      }

      if (result.success && result.data) {
        // Parse JSON from response
        let jsonText = result.data.trim();
        // Remove markdown code blocks if present
        if (jsonText.startsWith("```")) {
          jsonText = jsonText.replace(/```json?\n?/g, "").replace(/```$/g, "").trim();
        }

        try {
          const triageResult = JSON.parse(jsonText) as Array<{
            filename: string;
            tier: number;
            reason: string;
            section: string;
          }>;

          // Apply triage results
          for (const item of triageResult) {
            const img = images.find(i => i.name === item.filename);
            if (img) {
              img.tier = item.tier;
              img.section = item.section;
              img.reason = item.reason;
            }
          }
        } catch (parseErr) {
          console.error("Failed to parse triage JSON:", parseErr);
        }
      }
    } catch (err) {
      console.error("Triage failed:", err);
    }

    // Default: assign unclassified images to Tier 2 / 방법
    for (const img of images) {
      if (!img.tier) img.tier = 2;
      if (!img.section) img.section = "방법";
    }
  }

  /**
   * Generate a single section with context (Gemini - supports multimodal)
   */
  private async generateSectionGemini(
    client: GeminiClient,
    sectionName: string,
    sourceContent: string,
    metadata: { title: string; title_ko: string },
    previousSections: string,
    sectionImages: ImageAsset[],
    langInstruction: string
  ): Promise<string> {
    // Build images info
    let imagesInfo = "(이 섹션에 배정된 이미지 없음)";
    if (sectionImages.length > 0) {
      imagesInfo = "다음 이미지들을 블로그에 포함하고 상세히 설명하세요:\n";
      for (const img of sectionImages) {
        const tierLabel = img.tier === 1 ? "🌟 Critical" : "🔸 Supporting";
        imagesInfo += `- ![[${img.relativePath}]] (${tierLabel})\n`;
        imagesInfo += `  분석: ${(img.analysis || "").slice(0, 300)}...\n\n`;
      }
    }

    // Get section prompt
    let sectionPrompt = SECTION_PROMPTS[sectionName] || "";
    sectionPrompt = sectionPrompt
      .replace("{previous_sections}", previousSections.slice(-4000) || "(첫 섹션)")
      .replace("{images_info}", imagesInfo);

    // Build user content with images
    const userParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

    userParts.push({
      text: `논문 메타데이터:
- Title: ${metadata.title}
- Title (Korean): ${metadata.title_ko || "N/A"}

${langInstruction}

${sectionPrompt}

원문 내용:
${sourceContent.slice(0, 6000)}

---
Output the section in markdown. Start with the section heading.`,
    });

    // Attach images
    for (const img of sectionImages) {
      userParts.push({ text: `\nImage: ${img.relativePath}` });
      userParts.push({
        inlineData: { mimeType: img.mimeType, data: img.data },
      });
    }

    const usageTracker = getUsageTracker();
    const model = this.settings.blogModel;
    const provider = getProviderFromModel(model);

    try {
      const result = await client.generateContentWithParts(userParts, {
        temperature: 0.5,
        maxOutputTokens: 4096,
      });

      // Record usage if available
      if (result.usage) {
        usageTracker.recordUsage({
          provider,
          model,
          feature: "blog",
          usage: result.usage,
        });
      }

      if (result.success && result.data) {
        return result.data.trim();
      }
      const errorMsg = result.error || "Unknown error";
      console.error(`[BlogGenerator] Section ${sectionName} failed:`, errorMsg);
      return `## ${sectionName}\n\n(생성 실패: ${errorMsg})`;
    } catch (err) {
      console.error(`[BlogGenerator] Section ${sectionName} exception:`, err);
      return `## ${sectionName}\n\n(생성 실패: ${err})`;
    }
  }

  /**
   * Generate a single section with context (Text-only models - OpenAI compatible)
   */
  private async generateSectionText(
    client: OpenAICompatibleClient,
    sectionName: string,
    sourceContent: string,
    metadata: { title: string; title_ko: string },
    previousSections: string,
    images: ImageAsset[],
    langInstruction: string
  ): Promise<string> {
    // Build images info (text only - no actual image data)
    let imagesInfo = "(이미지 분석 없이 텍스트만으로 작성)";
    const sectionImages = images.filter(img => img.section === sectionName && img.tier !== 3);
    if (sectionImages.length > 0) {
      imagesInfo = "다음 이미지들을 블로그에 포함하세요 (이미지 참조만):\n";
      for (const img of sectionImages) {
        imagesInfo += `- ![[${img.relativePath}]]\n`;
      }
    }

    // Get section prompt
    let sectionPrompt = SECTION_PROMPTS[sectionName] || "";
    sectionPrompt = sectionPrompt
      .replace("{previous_sections}", previousSections.slice(-4000) || "(첫 섹션)")
      .replace("{images_info}", imagesInfo);

    const prompt = `논문 메타데이터:
- Title: ${metadata.title}
- Title (Korean): ${metadata.title_ko || "N/A"}

${langInstruction}

${sectionPrompt}

원문 내용:
${sourceContent.slice(0, 6000)}

---
Output the section in markdown. Start with the section heading.`;

    const usageTracker = getUsageTracker();
    const model = this.settings.blogModel;
    const provider = getProviderFromModel(model);

    try {
      const result = await client.chatCompletion(
        [{ role: "user", content: prompt }],
        { temperature: 0.5, maxTokens: 4096 }
      );

      // Record usage if available
      if (result.usage) {
        usageTracker.recordUsage({
          provider,
          model,
          feature: "blog",
          usage: result.usage,
        });
      }

      if (result.success && result.data) {
        // Remove code blocks if LLM wrapped output
        let text = result.data;
        if (text.startsWith("```")) {
          const lines = text.split("\n");
          if (lines[0].startsWith("```")) {
            lines.shift();
          }
          if (lines.length > 0 && lines[lines.length - 1].trim() === "```") {
            lines.pop();
          }
          text = lines.join("\n");
        }
        return text.trim();
      }
      const errorMsg = result.error || "Unknown error";
      console.error(`[BlogGenerator] Text section ${sectionName} failed:`, errorMsg);
      return `## ${sectionName}\n\n(생성 실패: ${errorMsg})`;
    } catch (err) {
      console.error(`[BlogGenerator] Text section ${sectionName} exception:`, err);
      return `## ${sectionName}\n\n(생성 실패: ${err})`;
    }
  }

  /**
   * Parse paper content into sections
   */
  private parseSections(content: string): Record<string, string> {
    const sections: Record<string, string> = {};
    let currentSection = "intro";
    let currentContent: string[] = [];

    for (const line of content.split("\n")) {
      if (line.startsWith("##") || line.startsWith("#")) {
        // Save previous section
        if (currentContent.length > 0) {
          sections[currentSection] = currentContent.join("\n").trim();
          currentContent = [];
        }

        // Determine new section
        const title = line.replace(/^#+\s*/, "").toLowerCase();
        if (title.includes("abstract") || title.includes("요약")) {
          currentSection = "abstract";
        } else if (title.includes("introduction") || title.includes("서론")) {
          currentSection = "introduction";
        } else if (title.includes("related") || title.includes("관련")) {
          currentSection = "related_work";
        } else if (title.includes("method") || title.includes("방법") || title.includes("approach")) {
          currentSection = "method";
        } else if (title.includes("experiment") || title.includes("실험") || title.includes("result")) {
          currentSection = "experiment";
        } else if (title.includes("conclusion") || title.includes("결론")) {
          currentSection = "conclusion";
        } else {
          currentSection = title.replace(/\s+/g, "_");
        }
      }
      currentContent.push(line);
    }

    // Save last section
    if (currentContent.length > 0) {
      sections[currentSection] = currentContent.join("\n").trim();
    }

    return sections;
  }

  /**
   * Analyze a single image
   */
  private async analyzeImage(
    client: GeminiClient,
    image: ImageAsset,
    fullContent: string,
    metadata: Record<string, string> | null
  ): Promise<string> {
    const imageContext = this.extractImageContext(fullContent, image.name);
    const titleContext = `Title: ${metadata?.title || "Unknown"}`;

    const paperContext = imageContext !== "(No direct text reference found)"
      ? `${titleContext}\n\n## Text References\n${imageContext}`
      : `${titleContext}\n\nContent:\n${fullContent.slice(0, 1500)}`;

    const analysisPrompt = `You are an expert at analyzing academic paper figures.
Tier: ${image.tier === 1 ? "CRITICAL (main figure)" : "SUPPORTING"}
Assigned Section: ${image.section}

Extract ALL details and provide structured analysis:

## Visual Inventory
[List all visible elements: text, shapes, data points]

## Core Findings
[3-5 key takeaways]

## Detailed Analysis
[Comprehensive explanation]

## Technical Details
[Numbers, dimensions, hyperparameters]

Output in Korean markdown.`;

    const result = await client.analyzeImage(
      { mimeType: image.mimeType, data: image.data },
      paperContext,
      analysisPrompt
    );

    // Record usage if available
    if (result.usage) {
      const usageTracker = getUsageTracker();
      const model = this.settings.blogModel;
      const provider = getProviderFromModel(model);
      usageTracker.recordUsage({
        provider,
        model,
        feature: "blog",
        usage: result.usage,
      });
    }

    return result.success && result.data ? result.data : "(분석 실패)";
  }

  /**
   * Extract context from paper text for a specific image
   */
  private extractImageContext(content: string, imageName: string): string {
    const numMatch = imageName.match(/(\d+)/);
    if (!numMatch) return "(No direct text reference found)";

    const num = numMatch[1];
    const patterns = [
      new RegExp(`Figure\\s*${num}[^0-9]`, "gi"),
      new RegExp(`Fig\\.?\\s*${num}[^0-9]`, "gi"),
      new RegExp(`그림\\s*${num}[^0-9]`, "gi"),
    ];

    const lines = content.split("\n");
    const chunks: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      for (const pattern of patterns) {
        if (pattern.test(lines[i])) {
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 5);
          const chunk = lines.slice(start, end).join("\n").trim();
          if (chunk && !chunks.includes(chunk)) {
            chunks.push(chunk);
          }
          break;
        }
      }
    }

    return chunks.length > 0 ? chunks.join("\n---\n") : "(No direct text reference found)";
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private async getPaperContent(folder: string): Promise<string | null> {
    const priorities = ["translated.md", "translated_raw.md", "original.md"];
    for (const filename of priorities) {
      const file = this.app.vault.getAbstractFileByPath(`${folder}/${filename}`);
      if (file instanceof TFile) {
        return await this.app.vault.read(file);
      }
    }
    return null;
  }

  private async getMetadata(folder: string): Promise<Record<string, string> | null> {
    const file = this.app.vault.getAbstractFileByPath(`${folder}/metadata.json`);
    if (file instanceof TFile) {
      try {
        return JSON.parse(await this.app.vault.read(file));
      } catch {
        return null;
      }
    }
    return null;
  }

  private async loadImagesWithData(folder: string, maxImages = 15): Promise<ImageAsset[]> {
    const imagesFolder = this.app.vault.getAbstractFileByPath(`${folder}/images`);
    if (!(imagesFolder instanceof TFolder)) return [];

    const imageFiles: TFile[] = [];
    for (const child of imagesFolder.children) {
      if (child instanceof TFile && /\.(png|jpg|jpeg|gif|webp)$/i.test(child.name)) {
        imageFiles.push(child);
      }
    }

    // Natural sort
    imageFiles.sort((a, b) => {
      const numA = parseInt(a.name.match(/\d+/)?.[0] || "0", 10);
      const numB = parseInt(b.name.match(/\d+/)?.[0] || "0", 10);
      return numA - numB;
    });

    const images: ImageAsset[] = [];
    const maxBytes = 4 * 1024 * 1024;

    for (const file of imageFiles.slice(0, maxImages)) {
      try {
        const stats = await this.app.vault.adapter.stat(`${folder}/images/${file.name}`);
        if (stats && stats.size > maxBytes) continue;

        const arrayBuffer = await this.app.vault.readBinary(file);
        const base64 = this.arrayBufferToBase64(arrayBuffer);

        const mimeTypes: Record<string, string> = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          gif: "image/gif", webp: "image/webp",
        };

        images.push({
          name: file.name,
          relativePath: `images/${file.name}`,
          mimeType: mimeTypes[file.extension.toLowerCase()] || "image/png",
          data: base64,
        });
      } catch (err) {
        console.error(`Failed to load ${file.name}:`, err);
      }
    }

    return images;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private generateFrontmatter(metadata: Record<string, unknown> | null, content?: string): string {
    const now = new Date().toISOString().split("T")[0];
    const title = typeof metadata?.title === "string" ? metadata.title : "Untitled Paper";
    const titleKo = typeof metadata?.title_ko === "string" ? metadata.title_ko : "";
    const arxivId = typeof metadata?.arxiv_id === "string" ? metadata.arxiv_id : "";

    const tags = new Set<string>(["paper-review", this.settings.blogStyle]);

    if (metadata?.categories && Array.isArray(metadata.categories)) {
      arxivCategoriesToTags(metadata.categories as string[]).forEach(t => tags.add(t.replace(/^#/, "")));
    }
    if (content) {
      extractTopicTags(content).forEach(t => tags.add(t.replace(/^#/, "")));
    }
    if (title) {
      extractTopicTags(title).forEach(t => tags.add(t.replace(/^#/, "")));
    }

    return `---
title: "${this.escapeYaml(titleKo || title)}"
date: ${now}
tags:
${Array.from(tags).map(t => `  - ${t}`).join("\n")}
paper_title: "${this.escapeYaml(title)}"
${titleKo ? `paper_title_ko: "${this.escapeYaml(titleKo)}"` : ""}
${arxivId ? `arxiv_id: "${arxivId}"` : ""}
${arxivId ? `arxiv_url: "https://arxiv.org/abs/${arxivId}"` : ""}
style: ${this.settings.blogStyle}
language: ${this.settings.blogLanguage}
generation_method: sequential
---`;
  }

  private escapeYaml(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\n/g, " ");
  }

  /**
   * Save file (create or overwrite)
   */
  private async saveFile(path: string, content: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }
}
