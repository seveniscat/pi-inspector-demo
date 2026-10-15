import type { Sentiment } from "./types.ts";

/** 情绪标签统一成 positive / neutral / negative，兼容中英文和常见写法 */
export function normSentiment(v: unknown): Sentiment | undefined {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return undefined;
  if (/积极|正面|正向|positive|pos|好评/.test(s)) return "positive";
  if (/消极|负面|负向|negative|neg|差评/.test(s)) return "negative";
  if (/中性|中立|neutral|neu/.test(s)) return "neutral";
  return undefined;
}
