import { getGenerative, missingProviderMessage } from "../lib/llm/index.js";
import {
  chunkText,
  setSseHeaders,
  startKeepAlive,
  writeDelta,
  writeDone,
  writeReasoningDelta,
  writeTelemetry,
} from "../lib/sse.js";
import { augment } from "./augmenter.js";
import { createAbortFromRequest, parseChatRequest } from "./gateway.js";
import { runParallelAnalysis } from "./planner.js";
import { LOW_STAKES_ROUTES, resolveRoute } from "./router.js";
import { verifyWithRewrite } from "./verification.js";
import { config } from "../config.js";

function sendJsonError(res, status, message) {
  if (res.headersSent) return false;
  res.status(status).json({ error: { message } });
  return true;
}

function createTelemetry(res, signal) {
  return {
    emit(payload) {
      if (signal.aborted || res.writableEnded) return;
      try {
        writeTelemetry(res, payload);
      } catch {
        // ignore write failures on a closing connection
      }
    },
  };
}

export async function runChatPipeline({ req, res, body }) {
  let parsed;
  try {
    parsed = parseChatRequest(body);
  } catch (err) {
    sendJsonError(res, err.status || 400, err.message || "Invalid request");
    return;
  }

  const { model, messages, userText, reasoning } = parsed;
  setSseHeaders(res);
  let stopKeepAlive = () => {};
  const { signal, cleanup } = createAbortFromRequest(req, res);
  const telemetry = createTelemetry(res, signal);

  try {
    telemetry.emit({ layer: "gateway", status: "done", model, messageCount: messages.length });

    const generative = getGenerative();
    if (!generative) {
      const err = new Error(missingProviderMessage());
      err.status = 502;
      throw err;
    }
    // Strong model for synthesis/rewrite passes on the deep path. Only
    // OpenCode Go splits models by role today; other providers reuse the
    // default model.
    const strongGenerative =
      generative.provider === "opencode-go"
        ? getGenerative({}, "strong")
        : null;

    telemetry.emit({
      layer: "provider",
      status: "active",
      provider: generative.provider,
      model: generative.model,
      strongModel: strongGenerative?.model,
    });

    const routeDecision = await resolveRoute({
      model,
      messages,
      userText,
      signal,
      telemetry,
    });
    const { route } = routeDecision;

    const augmented = augment({ route, messages, telemetry });
    const routeModel = routeDecision.model || model;

    if (LOW_STAKES_ROUTES.has(route)) {
      telemetry.emit({ layer: "egress", status: "streaming", route, model: routeModel });
      // Provider deltas are { type: 'text' | 'thinking', text }; thinking is
      // forwarded as reasoning_content so clients can show the model's
      // chain-of-thought separately from the answer.
      for await (const chunk of generative.stream({
        model: routeDecision.modelOverride || undefined,
        system: augmented.system,
        messages: augmented.messages,
        reasoning,
        signal,
      })) {
        const text = typeof chunk === "string" ? chunk : chunk.text;
        if (!text) continue;
        if (chunk?.type === "thinking") writeReasoningDelta(res, text, routeModel);
        else writeDelta(res, text, routeModel);
      }
      writeDone(res, routeModel);
      res.end();
      return;
    }

    // High-stakes parallel-analysis: emit keep-alives during blocking phases
    stopKeepAlive = startKeepAlive(res, routeModel, config.keepAliveMs);

    const { draft: initialDraft, subTasks, workerResults } = await runParallelAnalysis({
      generative,
      strongGenerative,
      system: augmented.system,
      messages: augmented.messages,
      userText,
      signal,
      telemetry,
    });

    // While the blocking verify/rewrite phases run, surface the parallel-analysis
    // worker outputs as reasoning so clients can show the execution path instead
    // of an empty stream. The final synthesized draft still rides on `content`.
    for (const [index, text] of (workerResults || []).entries()) {
      if (!text || !text.trim()) continue;
      if (signal.aborted || res.writableEnded) break;
      const id = subTasks?.[index]?.id || `worker-${index + 1}`;
      const task = subTasks?.[index]?.task ? ` (${subTasks[index].task})` : "";
      writeReasoningDelta(res, `─ Worker ${id}${task}\n${text}\n`, routeModel);
    }

    const { draft, verification, attempts } = await verifyWithRewrite({
      generative,
      strongGenerative,
      system: augmented.system,
      messages: augmented.messages,
      userText,
      route,
      initialDraft,
      workerResults,
      signal,
      telemetry,
    });

    if (verification && verification.available === false) {
      telemetry.emit({ layer: "verification", status: "skipped", reason: verification.reason });
      console.warn(`[verification] skipped: ${verification.reason}`);
    } else if (verification) {
      telemetry.emit({
        layer: "verification",
        status: "done",
        noul: verification.noul,
        score: verification.score,
        attempts,
        passed: verification.passed,
      });
      console.log(
        `[verification] route=${route} noul=${verification.noul} score=${verification.score} attempts=${attempts} passed=${verification.passed}`
      );
    }

    telemetry.emit({ layer: "egress", status: "streaming", route, model: routeModel });
    for (const piece of chunkText(draft, 80)) {
      if (signal.aborted) break;
      writeDelta(res, piece, routeModel);
    }
    writeDone(res, routeModel);
    res.end();
  } catch (err) {
    if (signal.aborted || err.message === "Client disconnected" || err.message === "Aborted") {
      try {
        res.end();
      } catch {
        // already closed
      }
      return;
    }

    const status = err.status || 500;
    const message = err.message || "Orchestrator error";
    console.error(`[pipeline] ${status}: ${message}`);

    try {
      telemetry.emit({ layer: "pipeline", status: "error", message });
    } catch {
      // ignore
    }

    if (!res.headersSent) {
      res.status(status).json({ error: { message } });
      return;
    }
    try {
      writeDelta(res, `\n\n[error] ${message}`, model);
      writeDone(res, model);
      res.end();
    } catch {
      try {
        res.end();
      } catch {
        // already closed
      }
    }
  } finally {
    stopKeepAlive();
    cleanup();
  }
}
