import type { TokenUsage, UsageCost } from "../types/usage";

/**
 * Model pricing table (USD per 1M tokens)
 * Prices based on official documentation as of 2025
 */
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

/**
 * Pricing table for all supported models
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Mistral OCR
  "mistral-ocr-latest": { inputPer1M: 1.00, outputPer1M: 1.00 },

  // xAI Grok models
  "grok-4.1-fast-non-reasoning": { inputPer1M: 0.10, outputPer1M: 0.30 },
  "grok-4.1-fast": { inputPer1M: 0.20, outputPer1M: 0.50 },
  "grok-4.1": { inputPer1M: 2.00, outputPer1M: 10.00 },

  // OpenAI models
  "gpt-5.2": { inputPer1M: 5.00, outputPer1M: 15.00 },
  "gpt-5.2-mini": { inputPer1M: 0.15, outputPer1M: 0.60 },
  "gpt-4o": { inputPer1M: 2.50, outputPer1M: 10.00 },

  // Anthropic Claude models
  "claude-4.5-opus": { inputPer1M: 15.00, outputPer1M: 75.00 },
  "claude-4.5-sonnet": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "claude-4.5-haiku": { inputPer1M: 1.00, outputPer1M: 5.00 },

  // Google Gemini models
  "gemini-3.0-pro": { inputPer1M: 1.25, outputPer1M: 5.00 },
  "gemini-3.0-flash": { inputPer1M: 0.50, outputPer1M: 2.00 },
  "gemini-2.5-flash-lite": { inputPer1M: 0.10, outputPer1M: 0.40 },

  // DeepSeek models
  "deepseek-r1": { inputPer1M: 0.55, outputPer1M: 2.19 },
  "deepseek-v3": { inputPer1M: 0.28, outputPer1M: 0.42 },

  // Groq models (fast inference)
  "llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
  "deepseek-r1-distill-llama-70b": { inputPer1M: 0.75, outputPer1M: 0.99 },
};

/**
 * Get provider name from model ID
 */
export function getProviderFromModel(model: string): string {
  if (model.startsWith("grok-")) return "xAI";
  if (model.startsWith("gpt-")) return "OpenAI";
  if (model.startsWith("claude-")) return "Anthropic";
  if (model.startsWith("gemini-")) return "Google";
  if (model.startsWith("deepseek-") && !model.includes("distill")) return "DeepSeek";
  if (model.startsWith("llama-") || model.includes("distill")) return "Groq";
  if (model.startsWith("mistral-")) return "Mistral";
  return "Unknown";
}

/**
 * Calculate cost for given token usage and model
 */
export function calculateCost(model: string, usage: TokenUsage): UsageCost {
  const pricing = MODEL_PRICING[model];

  if (!pricing) {
    // Default pricing if model not found (conservative estimate)
    console.warn(`[Pricing] Unknown model: ${model}, using default pricing`);
    return {
      inputCost: (usage.promptTokens / 1_000_000) * 1.0,
      outputCost: (usage.completionTokens / 1_000_000) * 2.0,
      totalCost: (usage.promptTokens / 1_000_000) * 1.0 + (usage.completionTokens / 1_000_000) * 2.0,
    };
  }

  const inputCost = (usage.promptTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPer1M;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

/**
 * Format cost as currency string
 */
export function formatCost(cost: number): string {
  if (cost < 0.0001) {
    return "$0.0000";
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  if (cost < 1) {
    return `$${cost.toFixed(3)}`;
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Format token count with commas
 */
export function formatTokens(tokens: number): string {
  return tokens.toLocaleString();
}
