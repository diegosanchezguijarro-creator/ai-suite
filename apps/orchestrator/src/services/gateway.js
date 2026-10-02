import { config } from "../config.js";
import { extractText } from "../lib/llm/normalize.js";

export function lastUserText(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      return extractText(messages[i].content);
    }
  }
  return "";
}

const EFFORTS = new Set(["low", "medium", "high"]);

// Accepts every common spellings of "please think":
//   reasoning_effort: "low" | "medium" | "high"        (OpenAI dialect)
//   thinking: true | { enabled, effort?, budget_tokens? }  (Anthropic dialect)
//   reasoning: same shapes as `thinking`
// Normalized decision: { enabled, effort, budgetTokens } | null.
export function parseReasoning(body) {
  const effortRaw = typeof body.reasoning_effort === "string" ? body.reasoning_effort.toLowerCase() : "";
  const raw = body.thinking ?? body.reasoning;
  let enabled = EFFORTS.has(effortRaw);
  let effort = EFFORTS.has(effortRaw) ? effortRaw : null;
  let budgetTokens = null;

  if (raw === true) enabled = true;
  else if (raw && typeof raw === "object") {
    if (raw.type === "enabled") enabled = true;
    else if (typeof raw.enabled === "boolean") enabled = raw.enabled;
    if (EFFORTS.has(String(raw.effort || "").toLowerCase())) effort = String(raw.effort).toLowerCase();
    const budget = Number(raw.budget_tokens ?? raw.budgetTokens);
    if (Number.isFinite(budget) && budget > 0) budgetTokens = budget;
  }

  if (!enabled) return null;
  return { enabled, effort, budgetTokens };
}

export function parseChatRequest(body) {
  if (!body || typeof body !== "object") {
    const err = new Error("Request body must be a JSON object");
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    const err = new Error("`messages` must be a non-empty array");
    err.status = 400;
    throw err;
  }

  const messages = body.messages
    .filter((m) => m && typeof m === "object")
    .map((m) => ({
      role: String(m.role || "user"),
      content: m.content ?? "",
    }));

  if (messages.length === 0) {
    const err = new Error("`messages` must contain at least one valid message");
    err.status = 400;
    throw err;
  }

  return {
    model: typeof body.model === "string" && body.model.trim() ? body.model.trim() : "agent-auto",
    stream: body.stream !== false,
    messages,
    userText: lastUserText(messages),
    reasoning: parseReasoning(body),
  };
}

export function createAbortFromRequest(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (controller.signal.aborted) return;
    if (res.writableFinished || res.writableEnded) return;
    controller.abort(new Error("Client disconnected"));
  };
  res.on("close", abort);
  return {
    signal: controller.signal,
    cleanup() {
      res.off?.("close", abort);
    },
  };
}

export { config };
