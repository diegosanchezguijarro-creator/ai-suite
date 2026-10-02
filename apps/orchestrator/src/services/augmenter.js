import { config } from "../config.js";
import { extractText } from "../lib/llm/normalize.js";

const ROUTE_SYSTEM_PROMPTS = {
  "general-chat":
    "You are a helpful, concise assistant. Answer directly and accurately. Prefer clarity over length.",
  "creative-writing":
    "You are a skilled creative writer. Craft engaging, vivid prose with a strong voice and intentional structure.",
  "parallel-analysis":
    "You are a rigorous analyst. Weigh multiple independent perspectives and synthesize them into one clear, balanced response.",
};

const STRUCTURAL_CONSTRAINT = "Output in valid Markdown.";

function messageChars(message) {
  return extractText(message.content).length + (message.images?.length || 0) * 1200 + 8;
}

export function pruneContext(messages, charLimit) {
  const conversation = (messages || []).filter((m) => m.role !== "system");
  if (conversation.length === 0) return [];

  const kept = [];
  let total = 0;
  for (let i = conversation.length - 1; i >= 0; i -= 1) {
    const message = conversation[i];
    const size = messageChars(message);
    if (kept.length > 0 && total + size > charLimit) break;
    kept.unshift(message);
    total += size;
    if (total >= charLimit) break;
  }
  return kept;
}

export function augment({ route, messages, telemetry }) {
  const systemFromClient = (messages || [])
    .filter((m) => m.role === "system")
    .map((m) => extractText(m.content).trim())
    .filter(Boolean);

  const system = [
    ROUTE_SYSTEM_PROMPTS[route] || ROUTE_SYSTEM_PROMPTS["general-chat"],
    STRUCTURAL_CONSTRAINT,
    ...systemFromClient,
  ].join("\n\n");

  const conversation = pruneContext(messages, config.context.charLimit);

  telemetry?.emit({
    layer: "augmenter",
    status: "done",
    route,
    systemPrompt: system,
    prunedMessageCount: conversation.length,
    originalMessageCount: (messages || []).filter((m) => m.role !== "system").length,
  });

  return { system, messages: conversation };
}
