import { routeForAgent } from "../agents.js";
import { config } from "../config.js";
import { heuristicRoute } from "../lib/fallbackRouter.js";
import { askChoice } from "../lib/jev.js";
import { isKnownGoModel } from "../lib/opencodeModels.js";
import { getCachedRoute, setCachedRoute } from "../lib/routeCache.js";

export const ROUTE_OPTIONS = {
  "general-chat":
    "Everyday Q&A, explanations, and helpful conversation. Direct, concise answers.",
  "creative-writing":
    "Stories, poems, marketing copy, and other prose. Lean into style and voice.",
  "parallel-analysis":
    "Multi-faceted questions needing several independent perspectives before synthesis.",
};

export const LOW_STAKES_ROUTES = new Set(["general-chat", "creative-writing"]);

export async function resolveRoute({ model, messages, userText, signal, telemetry }) {
  const agentRoute = routeForAgent(model);
  if (agentRoute) {
    telemetry?.emit({ layer: "router", status: "done", route: agentRoute, source: "agent", model });
    return { route: agentRoute, source: "agent", model };
  }

  // Direct model selection (e.g. OpenCode Go model id) — the model list is
  // filtered to cheap variants, so honor the user's choice for this stream.
  if (model && model !== "agent-auto" && (await isKnownGoModel(model))) {
    telemetry?.emit({ layer: "router", status: "done", route: "general-chat", source: "model", model });
    return {
      route: "general-chat",
      source: "model",
      model,
      modelOverride: model,
    };
  }

  // Identical prompts within the TTL reuse the previous decision, so follow-up
  // turns on the same question don't re-pay the decision round-trip.
  const cachedRoute = getCachedRoute(userText);
  if (cachedRoute) {
    telemetry?.emit({
      layer: "router",
      status: "done",
      route: cachedRoute,
      source: "cache",
      model,
    });
    return { route: cachedRoute, source: "cache", model };
  }

  telemetry?.emit({ layer: "router", status: "running", model, reason: "consulting decision model" });

  try {
    const answer = await askChoice({
      state: { messages, userText },
      instructions: "Which execution path best handles this user request?",
      criteria: ROUTE_OPTIONS,
      signal,
    });
    const probabilities = answer.probabilities ?? null;
    const confidence = answer.confidence ?? null;

    // A close race between options (independent per-route probabilities make
    // ~1/3 the floor for a 3-option argmax) isn't decisive. Escalate to the
    // deep path instead of committing to a near-tie.
    const floor = config.routing.confidenceFloor;
    const escalated =
      confidence != null && confidence < floor && answer.choice !== "parallel-analysis";

    const route = escalated ? "parallel-analysis" : answer.choice;
    setCachedRoute(userText, route);

    telemetry?.emit({
      layer: "router",
      status: "done",
      route,
      source: "decision",
      model,
      probabilities,
      confidence,
      escalated,
      floor: escalated ? floor : undefined,
    });
    return {
      route,
      source: "decision",
      model,
      probabilities,
      confidence,
      ...(escalated ? { escalated: true, reason: `low confidence ${Number(confidence).toFixed(2)} < ${floor}` } : {}),
    };
  } catch (err) {
    if (err.message === "Aborted") throw err;
    const route = heuristicRoute(userText);
    telemetry?.emit({
      layer: "router",
      status: "done",
      route,
      source: "fallback",
      model,
      reason: err.message || String(err),
    });
    return { route, source: "fallback", model, reason: err.message || String(err) };
  }
}
