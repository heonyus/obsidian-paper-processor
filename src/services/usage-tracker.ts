import type { TokenUsage, UsageCost, SessionUsageStats } from "../types/usage";
import { calculateCost, formatCost, formatTokens } from "../utils/pricing-table";

/**
 * Usage Tracker Service
 * Tracks API token usage and calculates costs across all API calls
 */
export class UsageTrackerService {
  private static instance: UsageTrackerService | null = null;
  private sessionStats: SessionUsageStats;
  private onChangeCallbacks: Array<(stats: SessionUsageStats) => void> = [];

  private constructor() {
    this.sessionStats = this.createEmptyStats();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): UsageTrackerService {
    if (!UsageTrackerService.instance) {
      UsageTrackerService.instance = new UsageTrackerService();
    }
    return UsageTrackerService.instance;
  }

  /**
   * Create empty session stats
   */
  private createEmptyStats(): SessionUsageStats {
    return {
      byProvider: {},
      byFeature: {},
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      totalCalls: 0,
      sessionStartTime: Date.now(),
    };
  }

  /**
   * Record usage for an API call
   */
  recordUsage(params: {
    provider: string;
    model: string;
    feature: "ocr" | "translation" | "blog";
    usage: TokenUsage;
  }): UsageCost {
    const { provider, model, feature, usage } = params;

    // Calculate cost
    const cost = calculateCost(model, usage);

    // Update provider stats
    if (!this.sessionStats.byProvider[provider]) {
      this.sessionStats.byProvider[provider] = {
        input: 0,
        output: 0,
        cost: 0,
        calls: 0,
      };
    }
    this.sessionStats.byProvider[provider].input += usage.promptTokens;
    this.sessionStats.byProvider[provider].output += usage.completionTokens;
    this.sessionStats.byProvider[provider].cost += cost.totalCost;
    this.sessionStats.byProvider[provider].calls += 1;

    // Update feature stats
    if (!this.sessionStats.byFeature[feature]) {
      this.sessionStats.byFeature[feature] = {
        input: 0,
        output: 0,
        cost: 0,
        calls: 0,
      };
    }
    this.sessionStats.byFeature[feature].input += usage.promptTokens;
    this.sessionStats.byFeature[feature].output += usage.completionTokens;
    this.sessionStats.byFeature[feature].cost += cost.totalCost;
    this.sessionStats.byFeature[feature].calls += 1;

    // Update totals
    this.sessionStats.totalInputTokens += usage.promptTokens;
    this.sessionStats.totalOutputTokens += usage.completionTokens;
    this.sessionStats.totalCost += cost.totalCost;
    this.sessionStats.totalCalls += 1;

    // Notify listeners
    this.notifyChange();

    console.debug(
      `[UsageTracker] ${feature}/${provider}/${model}: ` +
      `${formatTokens(usage.promptTokens)} in, ` +
      `${formatTokens(usage.completionTokens)} out, ` +
      `${formatCost(cost.totalCost)}`
    );

    return cost;
  }

  /**
   * Get current session stats
   */
  getSessionStats(): SessionUsageStats {
    return { ...this.sessionStats };
  }

  /**
   * Reset session stats
   */
  resetSession(): void {
    this.sessionStats = this.createEmptyStats();
    this.notifyChange();
    console.debug("[UsageTracker] Session reset");
  }

  /**
   * Register a callback for stats changes
   */
  onChange(callback: (stats: SessionUsageStats) => void): void {
    this.onChangeCallbacks.push(callback);
  }

  /**
   * Unregister a callback
   */
  offChange(callback: (stats: SessionUsageStats) => void): void {
    const index = this.onChangeCallbacks.indexOf(callback);
    if (index !== -1) {
      this.onChangeCallbacks.splice(index, 1);
    }
  }

  /**
   * Notify all listeners of stats change
   */
  private notifyChange(): void {
    const stats = this.getSessionStats();
    for (const callback of this.onChangeCallbacks) {
      try {
        callback(stats);
      } catch (err) {
        console.error("[UsageTracker] Callback error:", err);
      }
    }
  }

  /**
   * Get formatted summary string
   */
  getFormattedSummary(): string {
    const stats = this.sessionStats;
    const totalTokens = stats.totalInputTokens + stats.totalOutputTokens;

    return [
      `Total: ${formatTokens(totalTokens)} tokens (${formatTokens(stats.totalInputTokens)} in / ${formatTokens(stats.totalOutputTokens)} out)`,
      `Cost: ${formatCost(stats.totalCost)}`,
      `Calls: ${stats.totalCalls}`,
    ].join(" | ");
  }
}

// Export singleton getter for convenience
export function getUsageTracker(): UsageTrackerService {
  return UsageTrackerService.getInstance();
}
