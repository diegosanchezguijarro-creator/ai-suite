import { config } from "../../config.js";
import { randomUUID } from "node:crypto";
import { toAnthropicMessages, toOpenAiMessages } from "./normalize.js";
import { fetchResilient } from "./retry.js";

const USER_AGENT = "ai-orchestrator/0.1.0";

/** Models documented as Anthropic Messages dialect on OpenCode Go. */
const MESSAGES_MODELS = new Set([
  "minimax-m3",
  "minimax-m2.7",
  "qwen3.7-plus",
  "qwen3.8-max",
  "qwen3.8-flash",
  "qwen3.6-plus",
  "qwen3.5-plus",
]);

/** Models documented as OpenAI Responses API on OpenCode Go. */
const RESPONSES_MODELS = new Set([
  "grok-4.5",
  "grok-4.6",
  "grok-4.7",
  "gpt-5.6-luna",
  "gpt-6-luna",
  "muse-spark-1.3-contributor",
  "muse-spark-1.2-contributor",
]);

function baseUrl() {
  return config.generative.opencodeBaseUrl.replace(/\/$/, "");
}

function apiKey() {
  return config.generative.opencodeKey;
}

// Stable per-request session id: seeded from the conversation so prompts that
// share context reuse the same session (prompt caching), but never collide to
// a single value. randomUUID fallback guarantees a valid, unique id.
const sessionCache = new Map(); // seedHash -> { id, at }
const SESSION_CACHE_TTL_MS = 30 * 60_000;

function seedHash(messages) {
  const seed = JSON.stringify(messages || []).slice(0, 4096);
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function sessionId(messages) {
  if (config.generative.opencodeSession) return config.generative.opencodeSession;
  const hash = seedHash(messages);
  const now = Date.now();
  const cached = sessionCache.get(hash);
  if (cached && now - cached.at < SESSION_CACHE_TTL_MS) {
    cached.at = now;
    return cached.id;
  }
  // Keep the seed prefix for human correlation, plus a UUID for uniqueness.
  const id = `orch-${hash.toString(36)}-${randomUUID().slice(0, 8)}`;
  if (sessionCache.size > 200) {
    for (const [key, value] of sessionCache) {
      if (now - value.at > SESSION_CACHE_TTL_MS) sessionCache.delete(key);
    }
    if (sessionCache.size > 200) sessionCache.clear();
  }
  sessionCache.set(hash, { id, at: now });
  return id;
}

function headers(messages) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey()}`,
    "user-agent": USER_AGENT,
    "x-opencode-session": sessionId(messages),
  };
}

function endpointFor(model, kind) {
  if (kind === "messages" || MESSAGES_MODELS.has(model)) {
    return { kind: "messages", url: `${baseUrl()}/messages` };
  }
  if (kind === "responses" || RESPONSES_MODELS.has(model)) {
    return { kind: "responses", url: `${baseUrl()}/responses` };
  }
  return { kind: "chat", url: `${baseUrl()}/chat/completions` };
}

async function readError(res, label) {
  const text = await res.text().catch(() => "");
  return new Error(`OpenCode Go ${label} ${res.status}: ${text || res.statusText}`);
}

// --- extended thinking / reasoning -----------------------------------------

const THINKING_BUDGET = { low: 2048, medium: 8192, high: 16384 };

/** Map a normalized reasoning decision ({ enabled, effort, budgetTokens }) to
 * the Anthropic Messages `thinking` body param, keeping budget < max_tokens. */
function applyAnthropicThinking(body, reasoning) {
  if (!reasoning?.enabled) return;
  const budget = Math.max(
    1024,
    Number.isFinite(reasoning.budgetTokens)
      ? reasoning.budgetTokens
      : THINKING_BUDGET[reasoning.effort] || THINKING_BUDGET.medium
  );
  body.thinking = { type: "enabled", budget_tokens: budget };
  // Anthropic requires max_tokens to exceed the thinking budget.
  if ((body.max_tokens || 0) <= budget) body.max_tokens = budget + 2048;
}

/** Common delta picker for the Anthropic Messages SSE dialect. */
function pickAnthropicDelta(json) {
  if (json?.type !== "content_block_delta") return null;
  const delta = json.delta;
  if (delta?.type === "text_delta" && typeof delta.text === "string") {
    return { type: "text", text: delta.text };
  }
  if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
    return { type: "thinking", text: delta.thinking };
  }
  return null;
}

function effortOf(reasoning) {
  if (!reasoning?.enabled) return null;
  if (["low", "medium", "high"].includes(reasoning.effort)) return reasoning.effort;
  return "medium";
}

/** OpenAI Chat Completions dialect: reasoning_effort request param. */
function withReasoning(body, reasoning, model) {
  const effort = effortOf(reasoning);
  if (effort) body.reasoning_effort = effort;
  void model;
  return body;
}

/** OpenAI Responses dialect: reasoning: { effort } request param. */
function applyResponsesReasoning(body, reasoning) {
  const effort = effortOf(reasoning);
  if (effort) body.reasoning = { effort, summary: "auto" };
}

function flattenResponsesOutput(json) {
  const output = json.output;
  if (!Array.isArray(output)) return json.output_text ?? "";
  const parts = [];
  for (const item of output) {
    if (item?.type === "output_text" && typeof item.text === "string") {
      parts.push(item.text);
    } else if (Array.isArray(item?.content)) {
      for (const block of item.content) {
        if (typeof block?.text === "string") parts.push(block.text);
      }
    }
  }
  return parts.join("");
}

async function chatGenerate({ model, system, messages, signal, maxTokens, reasoning }) {
  const res = await fetchResilient(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: headers(messages),
    body: JSON.stringify(withReasoning({ model, max_tokens: maxTokens, messages: toOpenAiMessages(messages, system) }, reasoning, model)),
    signal,
  });
  if (!res.ok) throw await readError(res, "chat/completions");
  const json = await res.json();
  const choice = json.choices?.[0];
  const out = choice?.message?.content ?? "";
  // Reasoning models can spend the whole budget chain-of-thought and finish
  // with content: null + finish_reason: "length". Retry once with a bigger
  // budget so answer text actually gets generated.
  if (!out && choice?.finish_reason === "length" && (maxTokens || 0) < 16000) {
    return chatGenerate({
      model,
      system,
      messages,
      signal,
      maxTokens: Math.min(16000, (maxTokens || 2048) * 4),
      reasoning,
    });
  }
  return out;
}

async function* chatStream({ model, system, messages, signal, maxTokens, reasoning }) {
  const res = await fetchResilient(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: headers(messages),
    body: JSON.stringify(withReasoning({ model, max_tokens: maxTokens, stream: true, messages: toOpenAiMessages(messages, system) }, reasoning, model)),
  });
  if (!res.ok) throw await readError(res, "chat/completions");
  yield* readSseDeltas(res, (json) => {
    const delta = json.choices?.[0]?.delta;
    if (typeof delta?.reasoning_content === "string" && delta.reasoning_content) {
      return { type: "thinking", text: delta.reasoning_content };
    }
    const content = delta?.content;
    if (typeof content === "string" && content.length > 0) {
      return { type: "text", text: content };
    }
    return null;
  });
}

async function messagesGenerate({ model, system, messages, signal, maxTokens, reasoning }) {
  const body = {
    model,
    max_tokens: maxTokens || 2048,
    system,
    messages: toAnthropicMessages(messages),
  };
  applyAnthropicThinking(body, reasoning);
  const res = await fetchResilient(`${baseUrl()}/messages`, {
    method: "POST",
    headers: {
      ...headers(messages),
      "x-api-key": apiKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await readError(res, "messages");
  const json = await res.json();
  return (json.content || [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("");
}

async function* messagesStream({ model, system, messages, signal, maxTokens, reasoning }) {
  const body = {
    model,
    max_tokens: maxTokens || 2048,
    stream: true,
    system,
    messages: toAnthropicMessages(messages),
  };
  applyAnthropicThinking(body, reasoning);
  const res = await fetchResilient(`${baseUrl()}/messages`, {
    method: "POST",
    headers: {
      ...headers(messages),
      "x-api-key": apiKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await readError(res, "messages");
  yield* readSseDeltas(res, pickAnthropicDelta);
}

async function responsesGenerate({ model, system, messages, signal, maxTokens, reasoning }) {
  const body = {
    model,
    max_output_tokens: maxTokens,
    input: toOpenAiMessages(messages, system),
  };
  applyResponsesReasoning(body, reasoning);
  const res = await fetchResilient(`${baseUrl()}/responses`, {
    method: "POST",
    headers: headers(messages),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await readError(res, "responses");
  const json = await res.json();
  return flattenResponsesOutput(json);
}

async function* responsesStream({ model, system, messages, signal, maxTokens, reasoning }) {
  const body = {
    model,
    max_output_tokens: maxTokens,
    stream: true,
    input: toOpenAiMessages(messages, system),
  };
  applyResponsesReasoning(body, reasoning);
  const res = await fetchResilient(`${baseUrl()}/responses`, {
    method: "POST",
    headers: headers(messages),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await readError(res, "responses");
  yield* readSseDeltas(res, (json) => {
    if (json.type === "response.output_text.delta" && typeof json.delta === "string") {
      return { type: "text", text: json.delta };
    }
    if (
      (json.type === "response.reasoning_summary_text.delta" ||
        json.type === "response.reasoning_text.delta") &&
      typeof json.delta === "string" &&
      json.delta
    ) {
      return { type: "thinking", text: json.delta };
    }
    return null;
  });
}

/**
 * Reads an SSE body and yields provider-agnostic deltas: objects of the shape
 * { type: 'text' | 'thinking', text }. `pick(json)` returns one delta object or
 * null for irrelevant events.
 */
async function* readSseDeltas(res, pick) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const delta = pick(JSON.parse(data));
        if (delta && typeof delta.text === "string" && delta.text) yield delta;
      } catch {
        // ignore partial/non-JSON SSE lines
      }
    }
  }
}

export function isResponsesOnlyModel(model) {
  return RESPONSES_MODELS.has(model);
}

export function isMessagesOnlyModel(model) {
  return MESSAGES_MODELS.has(model);
}

export async function opencodeGenerate({ model, system, messages, signal, maxTokens = 2048, reasoning }) {
  const endpoint = endpointFor(model);
  if (endpoint.kind === "messages") {
    return messagesGenerate({ model, system, messages, signal, maxTokens, reasoning });
  }
  if (endpoint.kind === "responses") {
    return responsesGenerate({ model, system, messages, signal, maxTokens, reasoning });
  }
  return chatGenerate({ model, system, messages, signal, maxTokens, reasoning });
}

export async function* opencodeStream({ model, system, messages, signal, maxTokens = 2048, reasoning }) {
  const endpoint = endpointFor(model);
  if (endpoint.kind === "messages") {
    yield* messagesStream({ model, system, messages, signal, maxTokens, reasoning });
    return;
  }
  if (endpoint.kind === "responses") {
    yield* responsesStream({ model, system, messages, signal, maxTokens, reasoning });
    return;
  }
  yield* chatStream({ model, system, messages, signal, maxTokens, reasoning });
}

export async function fetchOpenCodeModels({ timeoutMs = 8000 } = {}) {
  if (!apiKey()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchResilient(`${baseUrl()}/models`, {
      headers: {
        authorization: `Bearer ${apiKey()}`,
        "user-agent": USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json?.data)) return null;
    return json.data
      .map((item) => item?.id)
      .filter((id) => typeof id === "string" && id.length > 0);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
