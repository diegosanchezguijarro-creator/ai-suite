export function setSseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (res.flushHeaders) res.flushHeaders();
}

function flush(res) {
  if (typeof res.flush === "function") res.flush();
}

export function sseChunk(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  flush(res);
}

function chunkBase(model) {
  return {
    id: `chatcmpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: model || "orchestrator",
  };
}

export function writeDelta(res, content, model) {
  sseChunk(res, {
    ...chunkBase(model),
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  });
}

// DeepSeek-compatible dialect: chain-of-thought rides on `reasoning_content`.
export function writeReasoningDelta(res, content, model) {
  sseChunk(res, {
    ...chunkBase(model),
    choices: [{ index: 0, delta: { reasoning_content: content }, finish_reason: null }],
  });
}

export function writeDone(res, model) {
  sseChunk(res, {
    ...chunkBase(model),
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
  res.write("data: [DONE]\n\n");
  flush(res);
}

export function writeKeepAlive(res, model) {
  res.write(": keep-alive\n\n");
  flush(res);
  sseChunk(res, {
    ...chunkBase(model),
    choices: [{ index: 0, delta: { content: "" }, finish_reason: null }],
  });
}

export function writeTelemetry(res, payload) {
  sseChunk(res, { object: "orchestrator.telemetry", ...payload });
}

export function startKeepAlive(res, model, ms = 10000) {
  const timer = setInterval(() => {
    try {
      writeKeepAlive(res, model);
    } catch {
      clearInterval(timer);
    }
  }, ms);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}

export function chunkText(text, size = 80) {
  if (!text) return [""];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    if (end < text.length) {
      const probe = text.slice(i, end + 48);
      const boundary = /[.!?]\s|\n/.exec(probe);
      if (boundary) end = i + boundary.index + boundary[0].length;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}
