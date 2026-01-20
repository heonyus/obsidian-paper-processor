import { requestUrl } from "obsidian";

export interface ArxivPaper {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  updated: string;
  categories: string[];
  primaryCategory: string;
  pdfUrl: string;
  arxivUrl: string;
  doi?: string;
}

export interface ArxivSearchResult {
  success: boolean;
  papers?: ArxivPaper[];
  totalResults?: number;
  error?: string;
}

export interface ArxivSearchOptions {
  category?: string;
  maxResults?: number;
  start?: number;
  sortBy?: "submittedDate" | "relevance" | "lastUpdatedDate";
}

// OpenAlex API 응답 타입 정의
interface OpenAlexLocation {
  source?: { display_name?: string };
  landing_page_url?: string;
  pdf_url?: string;
}

interface OpenAlexAuthorship {
  author?: { display_name?: string };
}

interface OpenAlexTopic {
  display_name?: string;
}

interface OpenAlexWork {
  id?: string;
  title?: string;
  doi?: string;
  publication_date?: string;
  updated_date?: string;
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: OpenAlexAuthorship[];
  locations?: OpenAlexLocation[];
  primary_location?: OpenAlexLocation;
  best_oa_location?: OpenAlexLocation;
  topics?: OpenAlexTopic[];
  primary_topic?: OpenAlexTopic;
  ids?: { openalex?: string };
}

// arXiv ID 패턴 (여러 형식 지원)
const ARXIV_ID_PATTERNS = [
  // URL: https://arxiv.org/abs/2312.12345
  /(?:https?:\/\/)?(?:www\.)?arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i,
  // URL (구 형식): https://arxiv.org/abs/cs/0601001
  /(?:https?:\/\/)?(?:www\.)?arxiv\.org\/(?:abs|pdf)\/([a-z-]+(?:\.[A-Z]{2})?\/[0-9]{7}(?:v\d+)?)/i,
  // arXiv: 접두사: arXiv:2312.12345
  /arxiv:\s*([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i,
  // arXiv: 접두사 (구 형식): arXiv:cs/0601001
  /arxiv:\s*([a-z-]+(?:\.[A-Z]{2})?\/[0-9]{7}(?:v\d+)?)/i,
  // 맨 ID (신 형식): 2312.12345
  /^([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)$/,
  // 맨 ID (구 형식): cs/0601001
  /^([a-z-]+(?:\.[A-Z]{2})?\/[0-9]{7}(?:v\d+)?)$/i,
];

/**
 * arXiv 검색 서비스
 */
export class ArxivSearchService {
  private baseUrl = "http://export.arxiv.org/api/query";
  private lastRequestTime = 0;
  private rateLimitDelay = 3000; // arXiv requires 3 second delay between requests

  /**
   * arXiv ID 추출 (다양한 형식 지원)
   */
  extractArxivId(input: string): string | null {
    const trimmed = input.trim();

    for (const pattern of ARXIV_ID_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match && match[1]) {
        // 버전 접미사 제거
        return match[1].replace(/v\d+$/, "");
      }
    }

    return null;
  }

  /**
   * Rate limiting 적용
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    if (elapsed < this.rateLimitDelay) {
      await this.sleep(this.rateLimitDelay - elapsed);
    }

    this.lastRequestTime = Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * arXiv 검색 (OpenAlex fallback 포함)
   */
  async search(query: string, options: ArxivSearchOptions = {}): Promise<ArxivSearchResult> {
    try {
      // Rate limiting
      await this.enforceRateLimit();

      const { category, maxResults = 10, start = 0, sortBy = "submittedDate" } = options;

      // arXiv ID인지 확인
      const arxivId = this.extractArxivId(query);
      if (arxivId) {
        return await this.fetchById(arxivId);
      }

      // 긴 제목 형식의 쿼리인지 확인 (특수문자 포함, 30자 이상)
      const looksLikeTitle = query.length > 30 && /[():,']/.test(query);

      if (looksLikeTitle) {
        // 제목 검색은 OpenAlex를 먼저 시도 (더 나은 제목 매칭)
        console.debug("[ArxivSearch] Long title query detected, trying OpenAlex first...");
        const openAlexResult = await this.searchViaOpenAlex(query, maxResults);
        if (openAlexResult.success && openAlexResult.papers && openAlexResult.papers.length > 0) {
          return openAlexResult;
        }
        console.debug("[ArxivSearch] OpenAlex returned no results, falling back to arXiv...");
      }

      // 키워드 검색
      let searchQuery = this.buildSearchQuery(query);
      if (category) {
        searchQuery = `cat:${category} AND (${searchQuery})`;
      }

      const params = new URLSearchParams({
        search_query: searchQuery,
        start: start.toString(),
        max_results: maxResults.toString(),
        sortBy: sortBy,
        sortOrder: "descending",
      });

      const url = `${this.baseUrl}?${params.toString()}`;

      const response = await requestUrl({
        url,
        method: "GET",
        headers: {
          "User-Agent": "obsidian-paper-processor/1.0",
        },
      });

      if (response.status !== 200) {
        return {
          success: false,
          error: `arXiv API returned status ${response.status}`,
        };
      }

      const papers = this.parseAtomResponse(response.text);
      const totalResults = this.extractTotalResults(response.text);

      // arXiv 결과가 없으면 OpenAlex fallback 시도
      if (papers.length === 0 && query.length > 10) {
        console.debug("[ArxivSearch] No arXiv results, trying OpenAlex fallback...");
        const openAlexResult = await this.searchViaOpenAlex(query, maxResults);
        if (openAlexResult.success && openAlexResult.papers && openAlexResult.papers.length > 0) {
          return openAlexResult;
        }
      }

      return {
        success: true,
        papers,
        totalResults,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * OpenAlex API를 통한 논문 검색 (arXiv fallback용)
   * OpenAlex는 무료 API로, 하루 100,000 credits 제공 (검색당 10 credits)
   * https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication
   */
  private async searchViaOpenAlex(query: string, maxResults: number = 10): Promise<ArxivSearchResult> {
    try {
      // 특수문자 정리 및 인코딩
      const cleanedQuery = query
        .replace(/['']/g, "'")  // 스마트 따옴표 변환
        .replace(/[""]/g, '"')  // 스마트 쌍따옴표 변환
        .trim();
      const encodedQuery = encodeURIComponent(cleanedQuery);
      const url = `https://api.openalex.org/works?search=${encodedQuery}&per_page=${maxResults}&mailto=obsidian-paper-processor@users.noreply.github.com`;

      const response = await requestUrl({
        url,
        method: "GET",
        headers: {
          "User-Agent": "obsidian-paper-processor/1.0 (mailto:obsidian-paper-processor@users.noreply.github.com)",
        },
      });

      if (response.status !== 200) {
        console.warn(`[OpenAlex] API returned status ${response.status}`);
        return { success: false, error: `OpenAlex API returned status ${response.status}` };
      }

      const data = JSON.parse(response.text);
      const papers: ArxivPaper[] = [];

      for (const work of data.results || []) {
        // arXiv ID가 있는 논문만 추출
        const arxivId = work.ids?.openalex ? this.extractArxivIdFromOpenAlex(work) : null;

        if (arxivId) {
          // arXiv ID가 있으면 arXiv에서 상세 정보 가져오기
          const arxivResult = await this.fetchById(arxivId);
          if (arxivResult.success && arxivResult.papers && arxivResult.papers.length > 0) {
            papers.push(...arxivResult.papers);
          }
        } else {
          // arXiv ID가 없어도 OpenAlex 정보로 논문 추가 (DOI 기반)
          const paper = this.parseOpenAlexWork(work);
          if (paper) {
            papers.push(paper);
          }
        }

        // 최대 결과 수 제한
        if (papers.length >= maxResults) break;
      }

      return {
        success: true,
        papers,
        totalResults: data.meta?.count || papers.length,
      };
    } catch (error) {
      console.warn("[OpenAlex] Search failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * OpenAlex 작업에서 arXiv ID 추출
   */
  private extractArxivIdFromOpenAlex(work: OpenAlexWork): string | null {
    // locations에서 arXiv 찾기
    for (const location of work.locations || []) {
      if (location.source?.display_name?.toLowerCase().includes("arxiv")) {
        const landingPage = location.landing_page_url || "";
        const match = landingPage.match(/arxiv\.org\/abs\/([0-9]{4}\.[0-9]{4,5})/);
        if (match) return match[1];
      }
      // PDF URL에서도 확인
      const pdfUrl = location.pdf_url || "";
      const pdfMatch = pdfUrl.match(/arxiv\.org\/pdf\/([0-9]{4}\.[0-9]{4,5})/);
      if (pdfMatch) return pdfMatch[1];
    }

    // DOI에서 arXiv 확인 (10.48550/arxiv.XXXX.XXXXX 형식)
    const doi = work.doi || "";
    const doiMatch = doi.match(/10\.48550\/arxiv\.([0-9]{4}\.[0-9]{4,5})/i);
    if (doiMatch) return doiMatch[1];

    return null;
  }

  /**
   * OpenAlex 작업을 ArxivPaper 형식으로 변환
   */
  private parseOpenAlexWork(work: OpenAlexWork): ArxivPaper | null {
    if (!work.title) return null;

    const authors = (work.authorships || [])
      .map((a: OpenAlexAuthorship) => a.author?.display_name)
      .filter((name): name is string => Boolean(name));

    // primary_location 또는 best_oa_location에서 URL 추출
    const location = work.primary_location || work.best_oa_location || {};
    const pdfUrl = location.pdf_url || "";
    const landingUrl = location.landing_page_url || work.doi || "";

    // arXiv ID 추출 시도
    let arxivId = this.extractArxivIdFromOpenAlex(work);

    // DOI에서 추출
    if (!arxivId && work.doi) {
      const doiMatch = work.doi.match(/10\.48550\/arxiv\.([0-9]{4}\.[0-9]{4,5})/i);
      if (doiMatch) arxivId = doiMatch[1];
    }

    return {
      arxivId: arxivId || `openalex:${work.id?.split("/").pop() || "unknown"}`,
      title: work.title,
      authors,
      abstract: this.reconstructAbstract(work.abstract_inverted_index ?? null) || "",
      published: work.publication_date || "",
      updated: work.updated_date || work.publication_date || "",
      categories: (work.topics || []).slice(0, 3).map((t: OpenAlexTopic) => t.display_name).filter((name): name is string => Boolean(name)),
      primaryCategory: work.primary_topic?.display_name || "",
      pdfUrl: pdfUrl,
      arxivUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : landingUrl,
      doi: work.doi?.replace("https://doi.org/", ""),
    };
  }

  /**
   * OpenAlex inverted index에서 abstract 복원
   */
  private reconstructAbstract(invertedIndex: Record<string, number[]> | null): string {
    if (!invertedIndex) return "";

    const words: [string, number][] = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
      for (const pos of positions) {
        words.push([word, pos]);
      }
    }

    words.sort((a, b) => a[1] - b[1]);
    return words.map(([word]) => word).join(" ");
  }

  /**
   * arXiv ID로 논문 조회
   */
  async fetchById(arxivId: string): Promise<ArxivSearchResult> {
    try {
      await this.enforceRateLimit();

      const params = new URLSearchParams({
        id_list: arxivId,
        max_results: "1",
      });

      const url = `${this.baseUrl}?${params.toString()}`;

      const response = await requestUrl({
        url,
        method: "GET",
        headers: {
          "User-Agent": "obsidian-paper-processor/1.0",
        },
      });

      if (response.status !== 200) {
        return {
          success: false,
          error: `arXiv API returned status ${response.status}`,
        };
      }

      const papers = this.parseAtomResponse(response.text);

      return {
        success: true,
        papers,
        totalResults: papers.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * PDF 다운로드
   */
  async downloadPdf(arxivId: string): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
    try {
      await this.enforceRateLimit();

      const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;

      const response = await requestUrl({
        url: pdfUrl,
        method: "GET",
        headers: {
          "User-Agent": "obsidian-paper-processor/1.0",
        },
      });

      if (response.status !== 200) {
        return {
          success: false,
          error: `Failed to download PDF: HTTP ${response.status}`,
        };
      }

      // PDF 매직 바이트 검증
      const bytes = new Uint8Array(response.arrayBuffer);
      if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
        return {
          success: false,
          error: "Downloaded file is not a valid PDF",
        };
      }

      return {
        success: true,
        data: response.arrayBuffer,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 검색 쿼리 빌드
   * - 긴 쿼리(4+ 토큰): 핵심 단어 AND 조합 (제목+초록)
   * - 짧은 쿼리(1-3 토큰): 전체 검색
   */
  private buildSearchQuery(query: string): string {
    // 특수문자 정리 (하이픈 유지)
    const cleaned = query.trim().replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ");
    const tokens = cleaned.split(" ").filter(Boolean);

    // 짧은 쿼리 - 전체 검색
    if (tokens.length <= 3) {
      return `all:${cleaned}`;
    }

    // 불용어 목록
    const stopWords = new Set([
      "a", "an", "the", "in", "of", "for", "to", "and", "or", "with", "on", "at", "by", "from", "is", "are", "was", "were"
    ]);

    // 중요한 약어 (짧아도 유지)
    const importantAbbreviations = new Set([
      "ai", "ml", "nlp", "llm", "gpt", "rl", "cv", "dl", "nn", "gan", "vae", "rag", "mcp"
    ]);

    // 핵심 단어 추출 (불용어 제외, 2글자 이상 또는 중요 약어)
    const keyTerms = tokens.filter((t) => {
      const lower = t.toLowerCase();
      if (stopWords.has(lower)) return false;
      if (importantAbbreviations.has(lower)) return true;
      return t.length > 2;
    });

    // 핵심 단어가 6개 이하면 모두 사용, 아니면 앞 6개만
    const termsToUse = keyTerms.slice(0, 6);

    if (termsToUse.length === 0) {
      return `all:${cleaned}`;
    }

    // 제목 OR 초록에서 AND 검색
    // 예: (ti:Memory AND ti:Agents AND ti:Survey) OR (abs:Memory AND abs:Agents AND abs:Survey)
    const titleQuery = termsToUse.map((t) => `ti:${t}`).join(" AND ");
    const absQuery = termsToUse.map((t) => `abs:${t}`).join(" AND ");

    // 전체 검색도 추가 (fallback)
    const allQuery = `all:"${termsToUse.join(" ")}"`;

    return `(${titleQuery}) OR (${absQuery}) OR (${allQuery})`;
  }

  /**
   * Atom XML 응답 파싱
   */
  private parseAtomResponse(xml: string): ArxivPaper[] {
    const papers: ArxivPaper[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");

    const entries = doc.querySelectorAll("entry");

    entries.forEach((entry) => {
      const idEl = entry.querySelector("id");
      const titleEl = entry.querySelector("title");
      const summaryEl = entry.querySelector("summary");
      const publishedEl = entry.querySelector("published");
      const updatedEl = entry.querySelector("updated");

      if (!idEl || !titleEl) return;

      // arXiv ID 추출
      const idText = idEl.textContent || "";
      const arxivId = idText.split("/abs/").pop()?.replace(/v\d+$/, "") || "";

      // 제목 (줄바꿈 제거)
      const title = (titleEl.textContent || "").replace(/\s+/g, " ").trim();

      // 요약
      const abstract = (summaryEl?.textContent || "").replace(/\s+/g, " ").trim();

      // 저자들
      const authors: string[] = [];
      entry.querySelectorAll("author name").forEach((nameEl) => {
        if (nameEl.textContent) {
          authors.push(nameEl.textContent);
        }
      });

      // 카테고리
      const categories: string[] = [];
      let primaryCategory = "";
      entry.querySelectorAll("category").forEach((catEl) => {
        const term = catEl.getAttribute("term");
        if (term) {
          categories.push(term);
          // 첫 번째 카테고리가 primary
          if (!primaryCategory) {
            primaryCategory = term;
          }
        }
      });

      // DOI
      const doiEl = entry.querySelector("doi");
      const doi = doiEl?.textContent || undefined;

      papers.push({
        arxivId,
        title,
        authors,
        abstract,
        published: publishedEl?.textContent || "",
        updated: updatedEl?.textContent || "",
        categories,
        primaryCategory,
        pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
        arxivUrl: `https://arxiv.org/abs/${arxivId}`,
        doi,
      });
    });

    return papers;
  }

  /**
   * 총 결과 수 추출
   */
  private extractTotalResults(xml: string): number {
    const match = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
    return match ? parseInt(match[1], 10) : 0;
  }
}

// 카테고리 목록
export const ARXIV_CATEGORIES = [
  { id: "", label: "All Categories" },
  { id: "cs.AI", label: "Artificial Intelligence" },
  { id: "cs.CL", label: "Computation and Language (NLP)" },
  { id: "cs.CV", label: "Computer Vision" },
  { id: "cs.LG", label: "Machine Learning" },
  { id: "cs.IR", label: "Information Retrieval" },
  { id: "cs.NE", label: "Neural and Evolutionary Computing" },
  { id: "cs.RO", label: "Robotics" },
  { id: "stat.ML", label: "Statistics - Machine Learning" },
];
