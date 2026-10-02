import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
import { config } from "../config.js";

export class JevUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "JevUnavailableError";
  }
}

let jevClient = null;

function getJevClient() {
  const apiKey = config.decisions.fallback.apiKey;
  if (!apiKey) {
    throw new JevUnavailableError("No decision backend: set OPENROUTER_API_KEY (or TYPESAFE_API_KEY for JEV fallback)");
  }
  if (!jevClient) {
    jevClient = new TypeSafeClient({ apiKey });
  }
  return jevClient;
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const onAbort = () => reject(new Error("Aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal?.removeEventListener("abort", onAbort);
    });
  });
}

async function askTypesafe({ state, questions, signal }) {
  const client = getJevClient();
  return abortable(
    client.systemOne({
      state,
      model: config.decisions.fallback.model,
      questions,
    }),
    signal
  );
}

// ---------------------------------------------------------------------------
// OpenRouter Decisions API (primary). Mercury Decide and similar decision
// models return native choice / noul / score answers with calibrated
// probabilities. We normalize them into the same shape the rest of the
// pipeline expects, then fall back to JEV if OpenRouter is unavailable.
// ---------------------------------------------------------------------------

function useOpenRouter() {
  return Boolean(config.decisions.primary.apiKey);
}

function renderValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value[0] &&
    typeof value[0] === "object" &&
    "role" in value[0]
  ) {
    return value
      .map(
        (m) =>
          `${m.role ?? "message"}: ${
            typeof m.content === "string" ? m.content : JSON.stringify(m.content)
          }`
      )
      .join("\n");
  }
  return JSON.stringify(value);
}

function renderState(state) {
  if (state == null) return "";
  if (typeof state === "string") return state;
  if (Array.isArray(state)) return renderValue(state);
  return Object.entries(state)
    .map(([key, value]) => `${key}: ${renderValue(value)}`)
    .join("\n\n");
}

async function openRouterDecisions({ state, questions, signal }) {
  const { url, apiKey, model, timeoutMs } = config.decisions.primary;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let onAbort = null;

  try {
    if (signal) {
      onAbort = () => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
    }

    response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "ai-orchestrator",
      },
      body: JSON.stringify({
        model,
        state: typeof state === "string" ? state : renderState(state),
        questions,
        provider: { allow_fallbacks: true },
      }),
    });
  } catch (err) {
    if (err.name === "AbortError" || err.message === "Aborted") throw err;
    throw new JevUnavailableError(`OpenRouter decisions unreachable: ${err.message || String(err)}`);
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }

  let json = null;
  try {
    json = await response.json();
  } catch {
    // non-JSON body handled below
  }

  if (!response.ok) {
    const apiMessage = json?.error?.message || `HTTP ${response.status}`;
    throw new JevUnavailableError(`OpenRouter decisions: ${apiMessage}`);
  }

  if (!json?.answers || typeof json.answers !== "object") {
    throw new JevUnavailableError("OpenRouter decisions response is missing answers");
  }

  return json;
}

function requireAnswer(answers, key) {
  const answer = answers?.[key];
  if (!answer || typeof answer !== "object") {
    throw new JevUnavailableError(`Missing answer for "${key}"`);
  }
  return answer;
}

async function mercuryAskChoice({ state, instructions, criteria, signal }) {
  const options = { ...(criteria ?? {}), none: "None of the other options fit this request." };
  const response = await openRouterDecisions({
    state,
    signal,
    questions: {
      decision: {
        type: "choice",
        instructions,
        criteria: options,
      },
    },
  });

  const answer = requireAnswer(response.answers, "decision");
  const probabilities = answer.probabilities ?? {};
  const selected = answer.choice ?? "none";

  // If the model picks "none", escalate to the deep path.
  const choice = selected === "none" ? "parallel-analysis" : selected;
  const confidence = probabilities[selected] ?? answer.confidence ?? 0;

  return { choice, probabilities, confidence };
}

async function mercuryAskNoul({ state, instructions, criteria, signal }) {
  const response = await openRouterDecisions({
    state,
    signal,
    questions: {
      verdict: {
        type: "noul",
        instructions,
        criteria: {
          true: criteria?.true ?? "Applies",
          false: criteria?.false ?? "Does not apply",
        },
      },
    },
  });
  const answer = requireAnswer(response.answers, "verdict");
  if (typeof answer.noul !== "number") {
    throw new JevUnavailableError(`Missing noul value for "verdict"`);
  }
  return answer;
}

async function mercuryAskScore({ state, instructions, criteria, signal }) {
  const response = await openRouterDecisions({
    state,
    signal,
    questions: {
      rating: {
        type: "score",
        instructions,
        criteria: criteria ?? ["low", "medium", "high"],
      },
    },
  });
  const answer = requireAnswer(response.answers, "rating");
  if (typeof answer.score !== "number") {
    throw new JevUnavailableError(`Missing score value for "rating"`);
  }
  return {
    score: answer.score,
    scoreConfidence: answer.confidence ?? null,
    scoreLegend: answer.legend ?? null,
  };
}

async function mercuryAskVerification({ state, signal }) {
  const response = await openRouterDecisions({
    state,
    signal,
    questions: {
      answers_user: {
        type: "noul",
        instructions: "Does this draft directly and accurately answer the user's original prompt?",
        criteria: {
          true: "The draft directly and accurately answers the original prompt",
          false: "The draft misses, evades, contradicts, or misreads the original prompt",
        },
      },
      quality: {
        type: "score",
        instructions: "Rate the tone and helpfulness of this response on a 0-10 scale.",
        criteria: [
          "0 - Completely unhelpful, off-topic, or hostile",
          "1 - Almost entirely off-topic or unusable",
          "2 - Mostly irrelevant with minimal usefulness",
          "3 - Partially relevant but weak and unhelpful",
          "4 - Somewhat helpful but clearly flawed",
          "5 - Adequate: on-topic but generic or shallow",
          "6 - Decent: mostly helpful with minor issues",
          "7 - Good: clear, helpful, mostly on-tone",
          "8 - Very good: polished, helpful, well-toned",
          "9 - Excellent: thorough, precise, excellent tone",
          "10 - Exceptional: complete, insightful, perfectly toned",
        ],
      },
    },
  });

  const noulAnswer = requireAnswer(response.answers, "answers_user");
  const scoreAnswer = requireAnswer(response.answers, "quality");

  return {
    noul: noulAnswer.noul,
    score: scoreAnswer.score,
    scoreConfidence: scoreAnswer.confidence ?? null,
    scoreLegend: scoreAnswer.legend ?? null,
  };
}

// ---------------------------------------------------------------------------
// JEV fallback helpers
// ---------------------------------------------------------------------------

function wrapAnswer(answers, key) {
  const answer = answers?.[key];
  if (!answer) throw new JevUnavailableError(`Missing JEV answer for "${key}"`);
  return answer;
}

async function jevAskChoice({ state, instructions, criteria, signal }) {
  const response = await askTypesafe({
    state,
    signal,
    questions: { decision: choice(instructions, criteria) },
  });
  return wrapAnswer(response.answers, "decision");
}

async function jevAskNoul({ state, instructions, criteria, signal }) {
  const response = await askTypesafe({
    state,
    signal,
    questions: { verdict: noul(instructions, criteria) },
  });
  return wrapAnswer(response.answers, "verdict");
}

async function jevAskScore({ state, instructions, criteria, signal }) {
  const response = await askTypesafe({
    state,
    signal,
    questions: { rating: score(instructions, criteria) },
  });
  return wrapAnswer(response.answers, "rating");
}

async function jevAskVerification({ state, signal }) {
  const response = await askTypesafe({
    state,
    signal,
    questions: {
      answers_user: noul(
        "Does this draft directly and accurately answer the user's original prompt?",
        {
          true: "The draft directly and accurately answers the original prompt",
          false: "The draft misses, evades, contradicts, or misreads the original prompt",
        }
      ),
      quality: score(
        "Rate the tone and helpfulness of this response on a 0-10 scale.",
        [
          "0 - Completely unhelpful, off-topic, or hostile",
          "1 - Almost entirely off-topic or unusable",
          "2 - Mostly irrelevant with minimal usefulness",
          "3 - Partially relevant but weak and unhelpful",
          "4 - Somewhat helpful but clearly flawed",
          "5 - Adequate: on-topic but generic or shallow",
          "6 - Decent: mostly helpful with minor issues",
          "7 - Good: clear, helpful, mostly on-tone",
          "8 - Very good: polished, helpful, well-toned",
          "9 - Excellent: thorough, precise, excellent tone",
          "10 - Exceptional: complete, insightful, perfectly toned",
        ]
      ),
    },
  });

  const noulAnswer = wrapAnswer(response.answers, "answers_user");
  const scoreAnswer = wrapAnswer(response.answers, "quality");

  return {
    noul: noulAnswer.noul,
    score: scoreAnswer.score,
    scoreConfidence: scoreAnswer.confidence ?? null,
    scoreLegend: scoreAnswer.legend ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public API. OpenRouter is tried first; JEV is used only when OpenRouter is
// not configured or fails. This keeps the old interface stable.
// ---------------------------------------------------------------------------

export async function askChoice(args) {
  if (useOpenRouter()) {
    try {
      return await mercuryAskChoice(args);
    } catch (err) {
      if (err.name === "AbortError" || err.message === "Aborted") throw err;
      // Fall through to JEV if we have it.
      if (!config.decisions.fallback.apiKey) throw err;
    }
  }
  return jevAskChoice(args);
}

export async function askNoul(args) {
  if (useOpenRouter()) {
    try {
      return await mercuryAskNoul(args);
    } catch (err) {
      if (err.name === "AbortError" || err.message === "Aborted") throw err;
      if (!config.decisions.fallback.apiKey) throw err;
    }
  }
  return jevAskNoul(args);
}

export async function askScore(args) {
  if (useOpenRouter()) {
    try {
      return await mercuryAskScore(args);
    } catch (err) {
      if (err.name === "AbortError" || err.message === "Aborted") throw err;
      if (!config.decisions.fallback.apiKey) throw err;
    }
  }
  return jevAskScore(args);
}

export async function askVerification(args) {
  if (useOpenRouter()) {
    try {
      return await mercuryAskVerification(args);
    } catch (err) {
      if (err.name === "AbortError" || err.message === "Aborted") throw err;
      if (!config.decisions.fallback.apiKey) throw err;
    }
  }
  return jevAskVerification(args);
}
