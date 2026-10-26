// Token usage and estimated cost, printed per country and per run.
import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages';

export type Usage = {
  requests: number;
  inputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  webSearches: number;
  webFetches: number;
  /** Requests that ran through the Message Batches API at half price. */
  batchRequests: number;
};

export const emptyUsage = (): Usage => ({
  requests: 0,
  inputTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  webSearches: 0,
  webFetches: 0,
  batchRequests: 0,
});

export function addUsage(total: Usage, usage: BetaUsage, batch: boolean): void {
  total.requests += 1;
  if (batch) total.batchRequests += 1;
  total.inputTokens += usage.input_tokens;
  total.outputTokens += usage.output_tokens;
  total.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  // cache_creation_input_tokens sums every iteration of a server tool loop, but the top-level
  // cache_creation breakdown can describe only the first one, so the total is the count and the
  // per-iteration breakdowns only say how much of it was written with the 1-hour lifetime.
  const breakdowns = usage.iterations
    ? usage.iterations
        .filter((entry) => entry.type !== 'compaction')
        .map((entry) => (entry as { cache_creation?: BetaUsage['cache_creation'] }).cache_creation)
    : [usage.cache_creation];
  const oneHour = breakdowns.reduce(
    (sum, entry) => sum + (entry?.ephemeral_1h_input_tokens ?? 0),
    0,
  );
  const writes =
    usage.cache_creation_input_tokens ??
    breakdowns.reduce(
      (sum, entry) =>
        sum + (entry?.ephemeral_5m_input_tokens ?? 0) + (entry?.ephemeral_1h_input_tokens ?? 0),
      0,
    );
  total.cacheWrite1hTokens += Math.min(oneHour, writes);
  total.cacheWrite5mTokens += Math.max(0, writes - oneHour);
  total.webSearches += usage.server_tool_use?.web_search_requests ?? 0;
  total.webFetches += usage.server_tool_use?.web_fetch_requests ?? 0;
}

export function sumUsage(list: Usage[]): Usage {
  const total = emptyUsage();
  for (const usage of list) {
    for (const key of Object.keys(total) as (keyof Usage)[]) total[key] += usage[key];
  }
  return total;
}

/** List prices in USD per million tokens (Claude API, October 2026). */
type Price = { input: number; output: number; cacheRead: number };

const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Web search is billed per search; fetched pages cost only their tokens. */
const WEB_SEARCH_PER_SEARCH = 10 / 1000;
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;
const BATCH_DISCOUNT = 0.5;

/**
 * Estimated cost in USD, or undefined for a model without a price here. Token costs of batch
 * requests are halved in proportion to the share of requests that were batched, which is exact
 * when a run is all batch or all synchronous. Refusal fallbacks are priced at the requested model.
 */
export function estimateCost(usage: Usage, model: string): number | undefined {
  const price = PRICES[model];
  if (!price) return undefined;
  const perToken = (perMillion: number) => perMillion / 1_000_000;
  const tokens =
    usage.inputTokens * perToken(price.input) +
    usage.cacheWrite5mTokens * perToken(price.input * CACHE_WRITE_5M) +
    usage.cacheWrite1hTokens * perToken(price.input * CACHE_WRITE_1H) +
    usage.cacheReadTokens * perToken(price.cacheRead) +
    usage.outputTokens * perToken(price.output);
  const batchShare = usage.requests ? usage.batchRequests / usage.requests : 0;
  return tokens * (1 - batchShare * BATCH_DISCOUNT) + usage.webSearches * WEB_SEARCH_PER_SEARCH;
}

const thousands = (value: number) => `${(value / 1000).toFixed(1)}k`;

export function formatUsage(usage: Usage, model: string): string {
  const cost = estimateCost(usage, model);
  return [
    `${usage.requests} request${usage.requests === 1 ? '' : 's'}`,
    `input ${thousands(usage.inputTokens)}`,
    `cache write ${thousands(usage.cacheWrite5mTokens + usage.cacheWrite1hTokens)}`,
    `cache read ${thousands(usage.cacheReadTokens)}`,
    `output ${thousands(usage.outputTokens)}`,
    `${usage.webSearches} searches`,
    `${usage.webFetches} fetches`,
    cost === undefined ? `cost unknown for ${model}` : `about $${cost.toFixed(2)}`,
  ].join(', ');
}
