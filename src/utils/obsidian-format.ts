/**
 * Obsidian-specific formatting utilities
 * Handles tags, wikilinks, and other Obsidian-native features
 */

/**
 * arXiv category to Obsidian tag mapping
 */
const ARXIV_CATEGORY_TAGS: Record<string, string[]> = {
  // Computer Science
  "cs.AI": ["#cs-ai", "#artificial-intelligence"],
  "cs.CL": ["#cs-cl", "#nlp", "#natural-language-processing"],
  "cs.CV": ["#cs-cv", "#computer-vision"],
  "cs.LG": ["#cs-lg", "#machine-learning"],
  "cs.IR": ["#cs-ir", "#information-retrieval"],
  "cs.NE": ["#cs-ne", "#neural-networks"],
  "cs.RO": ["#cs-ro", "#robotics"],
  "cs.CR": ["#cs-cr", "#security", "#cryptography"],
  "cs.DB": ["#cs-db", "#database"],
  "cs.DC": ["#cs-dc", "#distributed-computing"],
  "cs.HC": ["#cs-hc", "#human-computer-interaction"],
  "cs.SE": ["#cs-se", "#software-engineering"],

  // Statistics
  "stat.ML": ["#stat-ml", "#machine-learning", "#statistics"],
  "stat.TH": ["#stat-th", "#statistics"],

  // Math
  "math.ST": ["#math-st", "#statistics"],
  "math.OC": ["#math-oc", "#optimization"],

  // Physics (for ML papers)
  "physics.comp-ph": ["#physics", "#computational"],

  // Electrical Engineering
  "eess.AS": ["#audio", "#speech"],
  "eess.IV": ["#image-processing", "#video"],
};

/**
 * Common ML/AI concepts that should be wikilinked
 */
const WIKILINK_CONCEPTS: Record<string, string> = {
  // Architectures
  "transformer": "[[Transformer]]",
  "attention mechanism": "[[Attention Mechanism]]",
  "self-attention": "[[Self-Attention]]",
  "multi-head attention": "[[Multi-Head Attention]]",
  "BERT": "[[BERT]]",
  "GPT": "[[GPT]]",
  "T5": "[[T5]]",
  "LLaMA": "[[LLaMA]]",
  "Mistral": "[[Mistral]]",
  "Claude": "[[Claude]]",

  // Techniques
  "retrieval-augmented generation": "[[RAG]]",
  "RAG": "[[RAG]]",
  "fine-tuning": "[[Fine-tuning]]",
  "prompt engineering": "[[Prompt Engineering]]",
  "in-context learning": "[[In-Context Learning]]",
  "chain-of-thought": "[[Chain-of-Thought]]",
  "few-shot learning": "[[Few-Shot Learning]]",
  "zero-shot": "[[Zero-Shot Learning]]",
  "reinforcement learning": "[[Reinforcement Learning]]",
  "RLHF": "[[RLHF]]",

  // Memory & Knowledge
  "knowledge graph": "[[Knowledge Graph]]",
  "vector database": "[[Vector Database]]",
  "embedding": "[[Embedding]]",
  "semantic search": "[[Semantic Search]]",
  "long-term memory": "[[Long-Term Memory]]",
  "episodic memory": "[[Episodic Memory]]",

  // Evaluation
  "benchmark": "[[Benchmark]]",
  "ablation study": "[[Ablation Study]]",
  "perplexity": "[[Perplexity]]",
  "BLEU": "[[BLEU Score]]",
  "ROUGE": "[[ROUGE Score]]",
};

/**
 * Convert arXiv categories to Obsidian tags
 */
export function arxivCategoriesToTags(categories: string[]): string[] {
  const tags = new Set<string>();

  for (const cat of categories) {
    const mappedTags = ARXIV_CATEGORY_TAGS[cat];
    if (mappedTags) {
      mappedTags.forEach(tag => tags.add(tag));
    } else {
      // Fallback: convert category to tag format
      const fallbackTag = `#${cat.toLowerCase().replace(".", "-")}`;
      tags.add(fallbackTag);
    }
  }

  return Array.from(tags);
}

/**
 * Generate common topic tags from title/abstract
 */
export function extractTopicTags(text: string): string[] {
  const tags = new Set<string>();
  const lowerText = text.toLowerCase();

  // Topic detection patterns
  const topicPatterns: [RegExp, string][] = [
    [/\b(large language model|llm|llms)\b/i, "#llm"],
    [/\b(retrieval.augmented|rag)\b/i, "#rag"],
    [/\b(knowledge graph|kg)\b/i, "#knowledge-graph"],
    [/\b(transformer|attention)\b/i, "#transformer"],
    [/\b(fine.?tun|finetuning)\b/i, "#fine-tuning"],
    [/\b(prompt|prompting)\b/i, "#prompting"],
    [/\b(agent|agents|agentic)\b/i, "#ai-agents"],
    [/\b(memory|memorization)\b/i, "#memory"],
    [/\b(multimodal|vision.language|vlm)\b/i, "#multimodal"],
    [/\b(benchmark|evaluation)\b/i, "#benchmark"],
    [/\b(safety|alignment|harmless)\b/i, "#ai-safety"],
    [/\b(reinforcement learning|rl|rlhf)\b/i, "#reinforcement-learning"],
    [/\b(diffusion|stable diffusion|dalle)\b/i, "#diffusion"],
    [/\b(embedding|embeddings)\b/i, "#embeddings"],
    [/\b(chatbot|conversational)\b/i, "#conversational-ai"],
    [/\b(code generation|coding|codex)\b/i, "#code-generation"],
    [/\b(summarization|summary)\b/i, "#summarization"],
    [/\b(question answering|qa)\b/i, "#question-answering"],
    [/\b(sentiment|opinion)\b/i, "#sentiment-analysis"],
    [/\b(translation|nmt)\b/i, "#machine-translation"],
    [/\b(speech|asr|tts)\b/i, "#speech"],
    [/\b(survey|review)\b/i, "#survey"],
  ];

  for (const [pattern, tag] of topicPatterns) {
    if (pattern.test(lowerText)) {
      tags.add(tag);
    }
  }

  return Array.from(tags);
}

/**
 * Add wikilinks to recognized concepts in text
 */
export function addWikilinks(text: string): string {
  let result = text;

  // Sort by length (longest first) to avoid partial matches
  const sortedConcepts = Object.entries(WIKILINK_CONCEPTS)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [concept, wikilink] of sortedConcepts) {
    // Only replace if not already a wikilink
    const regex = new RegExp(`(?<!\\[\\[)\\b${escapeRegex(concept)}\\b(?!\\]\\])`, "gi");

    // Replace only first occurrence to avoid over-linking
    let replaced = false;
    result = result.replace(regex, (match) => {
      if (!replaced) {
        replaced = true;
        return wikilink;
      }
      return match;
    });
  }

  return result;
}

/**
 * Generate Obsidian frontmatter YAML
 */
export function generateFrontmatter(metadata: {
  title: string;
  titleKo?: string;
  authors?: string[];
  date?: string;
  arxivId?: string;
  categories?: string[];
  tags?: string[];
  source?: string;
}): string {
  const lines: string[] = ["---"];

  // Title
  lines.push(`title: "${escapeYaml(metadata.title)}"`);
  if (metadata.titleKo) {
    lines.push(`title_ko: "${escapeYaml(metadata.titleKo)}"`);
  }

  // Authors
  if (metadata.authors && metadata.authors.length > 0) {
    lines.push(`authors:`);
    for (const author of metadata.authors) {
      lines.push(`  - "${escapeYaml(author)}"`);
    }
  }

  // Date
  if (metadata.date) {
    lines.push(`date: ${metadata.date}`);
  }
  lines.push(`date_processed: ${new Date().toISOString().split("T")[0]}`);

  // arXiv info
  if (metadata.arxivId) {
    lines.push(`arxiv_id: "${metadata.arxivId}"`);
    lines.push(`arxiv_url: "https://arxiv.org/abs/${metadata.arxivId}"`);
  }

  // Categories
  if (metadata.categories && metadata.categories.length > 0) {
    lines.push(`categories:`);
    for (const cat of metadata.categories) {
      lines.push(`  - ${cat}`);
    }
  }

  // Tags (combine arXiv tags + topic tags)
  const allTags = new Set<string>();
  allTags.add("#paper");

  if (metadata.categories) {
    arxivCategoriesToTags(metadata.categories).forEach(t => allTags.add(t));
  }
  if (metadata.tags) {
    metadata.tags.forEach(t => allTags.add(t.startsWith("#") ? t : `#${t}`));
  }

  if (allTags.size > 0) {
    lines.push(`tags:`);
    for (const tag of allTags) {
      // Remove # for YAML array format
      lines.push(`  - ${tag.replace(/^#/, "")}`);
    }
  }

  // Source
  if (metadata.source) {
    lines.push(`source: "${escapeYaml(metadata.source)}"`);
  }

  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate Obsidian-style callouts
 */
export function createCallout(type: "note" | "tip" | "warning" | "info" | "abstract" | "summary", title: string, content: string): string {
  const lines = [`> [!${type}] ${title}`];
  for (const line of content.split("\n")) {
    lines.push(`> ${line}`);
  }
  return lines.join("\n");
}

/**
 * Create internal link to another paper
 */
export function createPaperLink(paperSlug: string, displayText?: string): string {
  if (displayText) {
    return `[[${paperSlug}|${displayText}]]`;
  }
  return `[[${paperSlug}]]`;
}

/**
 * Escape special characters for regex
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Escape special characters for YAML strings
 */
function escapeYaml(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, " ");
}

/**
 * Format paper metadata for Obsidian note
 */
export function formatPaperHeader(metadata: {
  title: string;
  titleKo?: string;
  authors?: string[];
  arxivId?: string;
  abstract?: string;
  categories?: string[];
}): string {
  const lines: string[] = [];

  // Title with alias
  if (metadata.titleKo) {
    lines.push(`# ${metadata.title}`);
    lines.push(`## ${metadata.titleKo}`);
  } else {
    lines.push(`# ${metadata.title}`);
  }
  lines.push("");

  // Paper info callout
  const infoLines: string[] = [];
  if (metadata.authors && metadata.authors.length > 0) {
    infoLines.push(`**Authors**: ${metadata.authors.slice(0, 5).join(", ")}${metadata.authors.length > 5 ? " et al." : ""}`);
  }
  if (metadata.arxivId) {
    infoLines.push(`**arXiv**: [${metadata.arxivId}](https://arxiv.org/abs/${metadata.arxivId})`);
  }
  if (metadata.categories && metadata.categories.length > 0) {
    const tags = arxivCategoriesToTags(metadata.categories);
    infoLines.push(`**Categories**: ${tags.join(" ")}`);
  }

  if (infoLines.length > 0) {
    lines.push(createCallout("info", "Paper Info", infoLines.join("\n")));
    lines.push("");
  }

  // Abstract
  if (metadata.abstract) {
    lines.push(createCallout("abstract", "Abstract", metadata.abstract));
    lines.push("");
  }

  return lines.join("\n");
}
