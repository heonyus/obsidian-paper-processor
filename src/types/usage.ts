/**
 * Token usage information from API responses
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

/**
 * Calculated cost for a single API call
 */
export interface UsageCost {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

/**
 * Usage record for a single API call
 */
export interface UsageRecord {
  timestamp: number;
  provider: string;
  model: string;
  feature: "ocr" | "translation" | "blog";
  usage: TokenUsage;
  cost: UsageCost;
}

/**
 * Aggregated stats by provider
 */
export interface ProviderStats {
  input: number;
  output: number;
  cost: number;
  calls: number;
}

/**
 * Aggregated stats by feature
 */
export interface FeatureStats {
  input: number;
  output: number;
  cost: number;
  calls: number;
}

/**
 * Session-level usage statistics
 */
export interface SessionUsageStats {
  byProvider: Record<string, ProviderStats>;
  byFeature: Record<string, FeatureStats>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalCalls: number;
  sessionStartTime: number;
}
