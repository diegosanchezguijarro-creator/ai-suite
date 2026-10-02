import { config } from "../../config.js";
import { toOpenAiMessages } from "./normalize.js";
import { fetchResilient } from "./retry.js";

function openAiUrl() {
  return `${config.generative.openaiBaseUrl}/v1/chat/completions`;
}

function headers() {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${config.generative.openaiKey}`,
  };
}

async function readError(res) {
  const text = await res.text().catch(() => "");
  return new Error(`OpenAI ${res.status}: ${text || res.statusText}`);
}

function buildRequest({ model, system, messages, maxTokens = 2048, reasoning }, stream) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages: toOpenAiMessages(messages, system),
    ...(stream ? { stream: true } : {}),
  };
  // Standard OpenAI reasoning models (o-series / gpt-5 style) take a plain
  // reasoning_effort string. Unknown to strict servers, so only sent when the
  // caller explicitly asked for reasoning.
  if (reasoning?.enabled) {
    body.reasoning_effort = ["low", "medium", "high"].includes(reasoning.effort)
      ? reasoning.effort
      : "medium";
  }
  return JSON.stringify(body);
}

export async function openaiGenerate(args) {
  const res = await fetchResilient(openAiUrl(), {
    method: "POST",
    headers: headers(),
    body: buildRequest(args, false),
    signal: args.signal,
  });
  if (!res.ok) throw await readError(res);
  const json = await res.json();
  const choice = json.choices?.[0];
  const out = choice?.message?.content ?? "";
  // Same reasoning-model failure mode as the OpenCode chat dialect: hidden
  // reasoning exhausts the budget leaving content null. One scaled-up retry.
  if (!out && choice?.finish_reason === "length" && (args.maxTokens || 0) < 16000) {
    return openaiGenerate({
      ...args,
      maxTokens: Math.min(16000, (args.maxTokens || 2048) * 4),
    });
  }
  return out;
}

export async function* openaiStream(args) {
  const res = await fetchResilient(openAiUrl(), {
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
        const delta = json.choices?.[0]?.delta || {};
        // DeepSeek-style dialects surface chain-of-thought here.
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          yield { type: "thinking", text: delta.reasoning_content };
        }
        if (typeof delta.content === "string" && delta.content.length > 0) {
          yield { type: "text", text: delta.content };
        }
      } catch {
        // ignore partial/non-JSON SSE lines
      }
    }
  }
}
