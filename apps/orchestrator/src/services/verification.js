import { config } from "../config.js";
import { askVerification, JevUnavailableError } from "../lib/jev.js";

export async function verifyDraft({ originalPrompt, route, draft, signal, telemetry }) {
  const state = {
    original_prompt: originalPrompt,
    route,
    draft,
  };

  telemetry?.emit({ layer: "verification", status: "running", prompt: state, model: config.decisions.primary.model });

  try {
    const result = await askVerification({ state, signal });
    const verdict = {
      available: true,
      noul: result.noul,
      score: result.score,
      scoreConfidence: result.scoreConfidence,
      passed: result.noul >= config.verification.noulThreshold,
      feedback: buildFeedback(result),
    };
    telemetry?.emit({ layer: "verification", status: "done", ...verdict });
    return verdict;
  } catch (err) {
    if (err instanceof JevUnavailableError || err.message === "Aborted") {
      if (err.message === "Aborted") throw err;
      telemetry?.emit({ layer: "verification", status: "skipped", reason: err.message });
      return {
        available: false,
        noul: null,
        score: null,
        passed: true,
        reason: err.message,
        feedback: null,
      };
    }
    telemetry?.emit({ layer: "verification", status: "error", message: err.message || String(err) });
    throw err;
  }
}

function buildFeedback({ noul, score }) {
  const parts = [];
  parts.push(`Reviewer noul (answers the prompt directly): ${Number(noul ?? 0).toFixed(2)} (threshold ${config.verification.noulThreshold}).`);
  parts.push(`Reviewer tone/helpfulness score (0-10): ${score == null ? "n/a" : Number(score).toFixed(2)}.`);
  if ((noul ?? 0) < config.verification.noulThreshold) {
    parts.push("Revise the draft so it more directly and accurately answers the user's original prompt.");
  }
  return parts.join(" ");
}

export async function verifyWithRewrite({
  generative,
  strongGenerative = null,
  system,
  messages,
  userText,
  route,
  initialDraft,
  workerResults,
  signal,
  telemetry,
}) {
  let draft = initialDraft;
  let verification = await verifyDraft({ originalPrompt: userText, route, draft, signal, telemetry });
  let attempts = 0;

  while (!verification.passed && attempts < config.verification.maxSynthesisAttempts) {
    attempts += 1;
    telemetry?.emit({ layer: "verification", status: "rewrite", attempt: attempts, feedback: verification.feedback });
    const { synthesizerDraft } = await import("./planner.js");
    draft = await synthesizerDraft({
      generative,
      strongGenerative,
      system,
      messages,
      userText,
      workerResults,
      signal,
      feedback: verification.feedback,
      telemetry,
    });
    verification = await verifyDraft({ originalPrompt: userText, route, draft, signal, telemetry });
  }

  return { draft, verification, attempts };
}
