import { App, TFile } from "obsidian";
import { OpenAICompatibleClient, showError, showSuccess } from "../utils/api-client";
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

// 기존 paper-ocr-translator와 동일한 프롬프트
const FAITHFUL_TRANSLATION_PROMPT = `당신은 AI/ML 학술 논문 전문 번역가입니다.

## 절대 규칙 (CRITICAL)

1. **언어**:
   - 출력은 반드시 한국어로 작성하세요.
   - 영어 문장이 그대로 남지 않도록 모두 번역하세요.

2. **완전성 최우선**:
   - 모든 문장, 모든 단어를 번역
   - 축약, 요약, 생략 절대 금지
   - 정보 추가 금지, 의미 변경 금지

3. **전문 용어 병기 (강제)**:
   - AI/CS 학술 용어는 첫 등장에 반드시 영어(한국어) 병기
   - 예: LLM(대형 언어 모델), attention mechanism(어텐션 메커니즘)
   - 재등장은 영어만 또는 영어(한국어) 중 선택 가능
   - 고유명사, 모델명, 데이터셋명은 영어 유지

4. **수식/참조 보존**:
   - 수식($$...$$, $...$) 내용은 한 글자도 변경 금지
   - Figure X, Table Y, Equation Z, 인용 [1] 형식 유지
   - 섹션 참조 유지

5. **OCR 가독성 보정 허용 (내용 불변)**:
   - 문단/줄바꿈은 가독성 향상을 위해 조정 가능
   - 긴 줄이 4~5줄 이상 이어지면 문장 경계에서 줄바꿈
   - 한 문단에 4~5문장 이상이면 2~3문단으로 분리
   - 3개 이상 나열은 불릿(-) 또는 넘버링(1., 2., 3.)으로 변환 가능
   - "(1)...(2)...(3)..." 패턴은 넘버링 리스트로 정리

6. **수식 블록 정리**:
   - \`$$\`만 단독으로 있으면 가능한 경우 블록 쌍을 맞춰 정리
   - 수식 내용 자체는 변경 금지

7. **가독성 강화 규칙**:
   - 긴 문장(40자 이상)은 2~3개로 분리
   - 각 문장 끝에 빈 줄 1개 추가
   - 너무 짧은 문장(10자 미만)은 의미가 자연스러우면 병합
   - 복잡한 조건절/열거는 불릿으로 분리
   - 긴 문단(5문장 이상)은 주제 전환 지점에서 분리
   - 불필요한 수동태/중복 표현은 최소화하되 의미는 유지
   - "~것이다", "~것으로 보인다"는 간결하게 정리

8. **서식/라텍스 렌더링 보정**:
   - 강조가 필요한 핵심 용어/소제목은 굵게(**...**) 또는 기울임(*...*)로 표시 가능
   - 단, 원문 의미를 바꾸거나 과도하게 남용하지 말 것
   - 라텍스 수식은 렌더링 오류가 나지 않도록 괄호/중괄호/백슬래시 균형 점검
   - \`\\mathcal\`, \`\\mathbf\`, \`\\langle\` 등 명령어가 끊기거나 잘못 인식된 경우 문맥을 보고 바로잡기
   - 수식 내용은 유지하되, 깨진 토큰/누락된 괄호/잘못된 구분 기호는 복원 가능

## 번역 스타일

- 존댓말 사용하지 마세요 ("합니다" X → "한다" O)
- 학술적 톤: "~이다", "~한다", "~된다"
- 단정적 표현 사용

## 이전 문맥 (참고용, 번역 안 함)
{previous_context}

## 현재 페이지 (아래를 번역하세요)
{text}

## 출력
순수 마크다운만 출력 (코드 블록 없이).
내용은 그대로 유지하되, 가독성 향상을 위한 줄바꿈/리스트 정리는 허용됩니다.`;

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
   * Translate a paper (faithful translation only)
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
    const client = this.createClient();
    const pages = this.splitByPages(content);
    const translations: string[] = [];
    let previousContext = "(첫 페이지)";

    this.updateProgress("translating", "번역 시작...", 0, 0, pages.length);

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const percent = Math.round(((i + 1) / pages.length) * 100);

      this.updateProgress("translating", `페이지 ${i + 1}/${pages.length} 번역 중...`, percent, i + 1, pages.length);

      // Build prompt with context
      const prompt = FAITHFUL_TRANSLATION_PROMPT
        .replace("{previous_context}", previousContext)
        .replace("{text}", page);

      const result = await client.chatCompletion([
        { role: "user", content: prompt },
      ], { temperature: 0.3, maxTokens: 16000 });

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

    this.updateProgress("complete", "번역 완료!", 100);
    showSuccess("번역 완료!");

    return {
      success: true,
      translation: fullTranslation,
    };
  }

  private createClient(): OpenAICompatibleClient {
    return new OpenAICompatibleClient(
      "https://api.x.ai/v1",
      this.settings.grokApiKey,
      this.settings.translationModel
    );
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
