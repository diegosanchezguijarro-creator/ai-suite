import { config } from "../../config.js";
import { toAnthropicMessages } from "./normalize.js";
import { fetchResilient } from "./retry.js";

function anthropicUrl() {
  return `${config.generative.anthropicBaseUrl}/v1/messages`;
}

function headers() {
  return {
    "content-type": "application/json",
    "x-api-key": config.generative.anthropicKey,
    "anthropic-version": "2023-06-01",
  };
}

async function readError(res) {
  const text = await res.text().catch(() => "");
  return new Error(`Anthropic ${res.status}: ${text || res.statusText}`);
}

const THINKING_BUDGET = { low: 2048, medium: 8192, high: 16384 };

function buildRequest({ model, system, messages, signal, maxTokens = 2048, reasoning }, stream) {
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: toAnthropicMessages(messages),
    ...(stream ? { stream: true } : {}),
  };
  if (reasoning?.enabled) {
    const budget = Math.max(
      1024,
      Number.isFinite(reasoning.budgetTokens)
        ? reasoning.budgetTokens
        : THINKING_BUDGET[reasoning.effort] || THINKING_BUDGET.medium
    );
    body.thinking = { type: "enabled", budget_tokens: budget };
    // Anthropic requires max_tokens to exceed the thinking budget.
    if (body.max_tokens <= budget) body.max_tokens = budget + 2048;
  }
  return JSON.stringify(body);
}

export async function anthropicGenerate(args) {
  const res = await fetchResilient(anthropicUrl(), {
    method: "POST",
    headers: headers(),
    body: buildRequest(args, false),
    signal: args.signal,
  });
  if (!res.ok) throw await readError(res);
  const json = await res.json();
  return (json.content || [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("");
}

export async function* anthropicStream(args) {
  const res = await fetchResilient(anthropicUrl(), {
    method: "POST",
    headers: headers(),
    body: buildRequest(args, true),
    signal: args.signal,
  });
  if (!res.ok) throw await readError(res);

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
        const json = JSON.parse(data);
        if (json.type !== "content_block_delta") continue;
        if (json.delta?.type === "text_delta" && json.delta.text) {
          yield { type: "text", text: json.delta.text };
        } else if (json.delta?.type === "thinking_delta" && json.delta.thinking) {
          yield { type: "thinking", text: json.delta.thinking };
        }
      } catch {
        // ignore partial/non-JSON SSE lines
      }
    }
  }
}
