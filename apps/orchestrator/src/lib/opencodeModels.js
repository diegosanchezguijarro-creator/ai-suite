import { AGENTS } from "../agents.js";
import { fetchOpenCodeModels } from "../lib/llm/opencode.js";

const CACHE_MS = 60_000;

// Cheap / fast / light variants. Used for direct chat, the planner, and
// parallel-analysis workers where latency and cost matter most.
export const FAST_GO_MODELS = new Set([
  "glm-5.3-flash",
  "deepseek-v4-flash",
  "deepseek-v4.1-flash",
  "qwen3.8-flash",
  "mimo-v2.6-flash",
  "longcat-2.0",
]);

// Stronger models reserved for synthesis and rewrite passes where a single
// high-quality draft saves an entire verification/rewrite round-trip.
export const STRONG_GO_MODELS = new Set([
  "kimi-k2.6",
  "kimi-k2.7-code",
  "kimi-k3",
  "glm-5.3",
  "qwen3.8-max",
  "deepseek-v4-pro",
]);

// Curated list advertised through /v1/models for direct selection: a small
// fast/strong spread instead of the full live catalog.
export const CURATED_GO_MODELS = [
  "glm-5.3-flash",
  "mimo-v2.6-flash",
  "deepseek-v4-flash",
  "deepseek-v4.1-flash",
  "qwen3.8-flash",
  "longcat-2.0",
  "kimi-k2.6",
  "glm-5.3",
  "qwen3.8-max",
  "kimi-k3",
  "gpt-5.6-luna",
  "gpt-6-luna",
];

export const FALLBACK_GO_MODELS = [...CURATED_GO_MODELS];

function isFastGoModel(id) {
  if (FAST_GO_MODELS.has(id)) return true;
  const lower = id.toLowerCase();
  return (
    lower.includes("flash") ||
    lower.includes("lite") ||
    lower.includes("mini") ||
    lower.includes("luna") ||
    lower.includes("longcat")
  );
}

let cache = { at: 0, ids: null };

export async function getOpenCodeModelIds() {
  const now = Date.now();
  if (cache.ids && now - cache.at < CACHE_MS) return cache.ids;
  const live = (await fetchOpenCodeModels()) || FALLBACK_GO_MODELS;
  const ids = live.filter((id) => isFastGoModel(id) || STRONG_GO_MODELS.has(id));
  cache = { at: now, ids };
  return ids;
}

/** The strong/synthesis model. kimi-k2.6 by default, overridable via env. */
export function strongModel() {
  return process.env.OPENCODE_GO_STRONG_MODEL || "kimi-k2.6";
}

export async function getOrchestratorModels() {
  let goIds;
  try {
    goIds = await getOpenCodeModelIds();
  } catch {
    goIds = [];
  }

  // Live fast/strong ids first, curated fallbacks ordered last.
  const list = dedupe([...goIds, ...FALLBACK_GO_MODELS]);
  const agentIds = new Set(AGENTS.map((a) => a.id));
  const goModels = list
    .filter((id) => !agentIds.has(id))
    .map((id) => ({
      id,
      object: "model",
      owned_by: "opencode-go",
    }));
  return { object: "list", data: [...AGENTS, ...goModels] };
}

function dedupe(ids) {
  return Array.from(new Set(ids));
}

export async function isKnownGoModel(model) {
  if (!model) return false;
  const ids = await getOpenCodeModelIds();
  if (ids.includes(model)) return true;
  return CURATED_GO_MODELS.includes(model);
}
