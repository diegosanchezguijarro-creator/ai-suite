import { spawn } from "node:child_process";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const ORCH_PORT = 18788;
const MOCK_PORT = 18789;
const OC_ORCH_PORT = 18790;
const OC_MOCK_PORT = 18791;

// Last request bodies the mocks received, for reasoning-param assertions.
const lastOpenAiBody = { v: null };
const lastOcBody = { v: null };

function mockCompletion(bodyText) {
  const isPlan = /JSON array of sub-tasks|Return only the JSON array|independent sub-tasks/i.test(bodyText);
  const isWorker = /Your sub-task/i.test(bodyText);
  const isSynth = /Weave the worker outputs|synthesizer/i.test(bodyText);

  if (isPlan) {
    return JSON.stringify([
      { id: "task-1", task: "Core question and constraints" },
      { id: "task-2", task: "Primary perspective" },
      { id: "task-3", task: "Alternative perspective" },
    ]);
  }
  if (isWorker) {
    return `Worker perspective for: ${bodyText.slice(0, 120).replace(/\s+/g, " ")}`;
  }
  if (isSynth) {
    return "## Synthesized draft\n\nThis is the final cohesive answer covering all worker angles.";
  }
  return "Hello from mock stream. This is the chat reply.";
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function writeChatSse(res, content) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
  });
  return (async () => {
    // Every mock chat stream emits one reasoning delta first so the thinking
    // path can be asserted end-to-end.
    res.write(
      `data: ${JSON.stringify({
        choices: [{ index: 0, delta: { reasoning_content: "pondering" }, finish_reason: null }],
      })}\n\n`
    );
    await delay(5);
    const parts = content.match(/.{1,20}/gs) || [content];
    for (const part of parts) {
      res.write(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: { content: part }, finish_reason: null }],
        })}\n\n`
      );
      await delay(5);
    }
    res.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`
    );
    res.write("data: [DONE]\n\n");
    res.end();
  })();
}

function startMock() {
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url?.includes("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [] }));
      return;
    }
    if (req.method !== "POST" || !req.url?.includes("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = await readBody(req);
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      // ignore
    }
    lastOpenAiBody.v = parsed;
    const content = mockCompletion(body);
    if (parsed.stream === true) {
      await writeChatSse(res, content);
      return;
    }
    await delay(80);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, () => resolve(server)));
}

function writeAnthropicSse(res, content) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
  });
  return (async () => {
    res.write(
      `data: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "musing about the request" },
      })}\n\n`
    );
    await delay(5);
    const parts = content.match(/.{1,15}/gs) || [content];
    for (const part of parts) {
      res.write(
        `data: ${JSON.stringify({
          type: "content_block_delta",
          delta: { type: "text_delta", text: part },
        })}\n\n`
      );
      await delay(5);
    }
    res.end();
  })();
}

function writeResponsesSse(res, content) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
  });
  return (async () => {
    const parts = content.match(/.{1,15}/gs) || [content];
    for (const part of parts) {
      res.write(
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: part,
        })}\n\n`
      );
      await delay(5);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  })();
}

function startOpenCodeMock() {
  const server = http.createServer(async (req, res) => {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "missing bearer token" } }));
      return;
    }
    const hasSession = Boolean(req.headers["x-opencode-session"]);
    if (!hasSession) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "missing x-opencode-session" } }));
      return;
    }

    if (req.method === "GET" && req.url?.includes("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [
            { id: "glm-5.3-flash", object: "model", owned_by: "opencode" },
            { id: "deepseek-v4-flash", object: "model", owned_by: "opencode" },
            { id: "qwen3.8-flash", object: "model", owned_by: "opencode" },
            { id: "gpt-5.6-luna", object: "model", owned_by: "opencode" },
          ],
        })
      );
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `unsupported ${req.method} ${req.url}` } }));
      return;
    }

    const body = await readBody(req);
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      // ignore
    }
    lastOcBody.v = parsed;
    const model = parsed.model || "glm-5.3-flash";

    // Anthropic Messages dialect
    if (req.url?.includes("/messages")) {
      const blockContent = `OpenCode messages reply via ${model}.`;
      if (parsed.stream === true) {
        await writeAnthropicSse(res, blockContent);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ content: [{ type: "text", text: blockContent }] }));
      return;
    }

    // OpenAI Responses dialect
    if (req.url?.includes("/responses")) {
      const respContent = `OpenCode responses reply via ${model}.`;
      if (parsed.stream === true) {
        await writeResponsesSse(res, respContent);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          output: [
            { type: "output_text", text: respContent },
          ],
        })
      );
      return;
    }

    // OpenAI Chat Completions dialect
    if (!req.url?.includes("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `unsupported ${req.method} ${req.url}` } }));
      return;
    }
    const content = `OpenCode Go reply via ${model}.`;
    if (parsed.stream === true) {
      await writeChatSse(res, content);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
  return new Promise((resolve) => server.listen(OC_MOCK_PORT, () => resolve(server)));
}

function startOrchestrator({ port, env }) {
  const child = spawn(process.execPath, ["index.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      TYPESAFE_API_KEY: "",
      OPENROUTER_API_KEY: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tag = `orch:${port}`;
  child.stdout.on("data", (d) => process.stdout.write(`[${tag}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${tag}] ${d}`));
  return child;
}

async function waitForServer(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await delay(100);
  }
  throw new Error(`Server not ready: ${url}`);
}

async function readSse(res) {
  return res.text();
}

function extractStreamedContent(sseText) {
  const contents = [];
  for (const line of sseText.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const json = JSON.parse(payload);
      const delta = json.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) contents.push(delta);
    } catch {
      // ignore
    }
  }
  return contents.join("");
}

function extractStreamedReasoning(sseText) {
  const reasoning = [];
  for (const line of sseText.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const json = JSON.parse(payload);
      const delta = json.choices?.[0]?.delta?.reasoning_content;
      if (typeof delta === "string" && delta.length > 0) reasoning.push(delta);
    } catch {
      // ignore
    }
  }
  return reasoning.join("");
}

/** Asserts the outgoing request carried the provider's reasoning param. */
function assertReasoningRequested(body, kind) {
  if (kind === "openai") {
    assert(body.reasoning_effort === "medium", `reasoning_effort missing: ${JSON.stringify(body).slice(0, 300)}`);
  } else if (kind === "anthropic") {
    const thinking = body.thinking;
    assert(
      thinking?.type === "enabled" && Number.isFinite(thinking.budget_tokens),
      `anthropic thinking block missing: ${JSON.stringify(body).slice(0, 300)}`
    );
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function runOpenAiPhase() {
  const mock = await startMock();
  const orch = startOrchestrator({
    port: ORCH_PORT,
    env: {
      GENERATIVE_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
      OPENAI_MODEL: "mock-model",
      OPENCODE_GO_API_KEY: "",
      OPENCODE_CONSOLE_TOKEN: "",
      OPENCODE_GO_BASE_URL: `http://127.0.0.1:${OC_MOCK_PORT}`,
      KEEP_ALIVE_MS: "40",
      VERIFY_NOUL_THRESHOLD: "0.85",
      MAX_SYNTHESIS_ATTEMPTS: "1",
    },
  });

  try {
    await waitForServer(`http://127.0.0.1:${ORCH_PORT}/healthz`);

    const modelsRes = await fetch(`http://127.0.0.1:${ORCH_PORT}/v1/models`);
    const models = await modelsRes.json();
    assert(modelsRes.ok, "models endpoint failed");
    assert(models.data.some((m) => m.id === "agent-auto"), "agent-auto missing from models");
    console.log("ok: /v1/models includes agents");

    const lowRes = await fetch(`http://127.0.0.1:${ORCH_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "agent-fast-chat",
        stream: true,
        messages: [{ role: "user", content: "Hello there" }],
        reasoning_effort: "medium",
      }),
    });
    const lowText = await readSse(lowRes);
    const lowContent = extractStreamedContent(lowText);
    const lowReasoning = extractStreamedReasoning(lowText);
    assert(lowRes.ok, `low-stakes request failed: ${lowText}`);
    assert(
      lowContent.includes("Hello from mock stream"),
      `low-stakes stream missing content, got: ${lowContent}`
    );
    assert(lowText.includes("data: [DONE]"), "low-stakes stream missing [DONE]");
    assert(
      lowReasoning.includes("pondering"),
      `low-stakes stream missing reasoning_content, got: ${lowReasoning}`
    );
    assert(
      lastOpenAiBody.v?.reasoning_effort === "medium",
      `upstream reasoning_effort not sent: ${JSON.stringify(lastOpenAiBody.v || {}).slice(0, 300)}`
    );
    console.log("ok: agent-fast-chat streams directly with thinking + [DONE]");

    const parallelRes = await fetch(`http://127.0.0.1:${ORCH_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "agent-parallel-thinker",
        stream: true,
        messages: [{ role: "user", content: "Compare three marketing angles for a new app" }],
      }),
    });
    const parallelText = await readSse(parallelRes);
    const parallelContent = extractStreamedContent(parallelText);
    const parallelReasoning = extractStreamedReasoning(parallelText);
    assert(parallelRes.ok, `parallel request failed: ${parallelText}`);
    assert(
      parallelContent.includes("Synthesized draft"),
      `parallel draft missing, got: ${parallelContent.slice(0, 400)}`
    );
    assert(parallelText.includes("data: [DONE]"), "parallel stream missing [DONE]");
    assert(parallelText.includes(": keep-alive"), "parallel route missing keep-alives");
    assert(
      parallelReasoning.includes("Worker task-1"),
      `parallel route missing worker reasoning, got: ${parallelReasoning.slice(0, 400)}`
    );
    console.log("ok: agent-parallel-thinker buffers, verifies, streams + keep-alives (worker results as reasoning)");

    const badRes = await fetch(`http://127.0.0.1:${ORCH_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "agent-fast-chat", messages: [] }),
    });
    assert(badRes.status === 400, `expected 400 for empty messages, got ${badRes.status}`);
    console.log("ok: invalid payload returns 400");
  } finally {
    orch.kill("SIGTERM");
    mock.close();
    await delay(200);
  }
}

async function runOpenCodePhase() {
  const mock = await startOpenCodeMock();
  const orch = startOrchestrator({
    port: OC_ORCH_PORT,
    env: {
      GENERATIVE_PROVIDER: "opencode-go",
      OPENCODE_GO_API_KEY: "oc-test-key",
      OPENCODE_GO_BASE_URL: `http://127.0.0.1:${OC_MOCK_PORT}`,
      OPENCODE_GO_MODEL: "glm-5.3-flash",
      OPENAI_API_KEY: "",
      OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
      ANTHROPIC_API_KEY: "",
      KEEP_ALIVE_MS: "40",
      VERIFY_NOUL_THRESHOLD: "0.85",
      MAX_SYNTHESIS_ATTEMPTS: "1",
    },
  });

  try {
    await waitForServer(`http://127.0.0.1:${OC_ORCH_PORT}/healthz`);

    const modelsRes = await fetch(`http://127.0.0.1:${OC_ORCH_PORT}/v1/models`);
    const models = await modelsRes.json();
    assert(modelsRes.ok, "opencode models endpoint failed");
    assert(models.data.some((m) => m.id === "agent-auto"), "agent-auto missing with opencode models");
    assert(
      models.data.some((m) => m.id === "glm-5.3-flash" && m.owned_by === "opencode-go"),
      `glm-5.3-flash missing from models: ${JSON.stringify(models.data.slice(0, 10))}`
    );
    assert(
      models.data.some((m) => m.id === "deepseek-v4-flash"),
      "deepseek-v4-flash missing from models"
    );
    console.log("ok: /v1/models merges OpenCode Go models");

    const agentRes = await fetch(`http://127.0.0.1:${OC_ORCH_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "agent-fast-chat",
        stream: true,
        messages: [{ role: "user", content: "Hello opencode" }],
      }),
    });
    const agentText = await readSse(agentRes);
    const agentContent = extractStreamedContent(agentText);
    const agentReasoning = extractStreamedReasoning(agentText);
    assert(agentRes.ok, `agent via opencode failed: ${agentText}`);
    assert(
      agentContent.includes("OpenCode Go reply via glm-5.3-flash"),
      `agent opencode stream mismatch: ${agentContent}`
    );
    assert(
      agentReasoning.includes("pondering"),
      `agent opencode stream missing reasoning: ${agentReasoning}`
    );
    console.log("ok: agent-fast-chat generates via OpenCode Go default model (thinking forward)");

    // Reasoning request → reasoning_effort on the chat dialect
    const thoughtRes = await fetch(`http://127.0.0.1:${OC_ORCH_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "agent-fast-chat",
        stream: true,
        messages: [{ role: "user", content: "Think it through" }],
        thinking: { type: "enabled", effort: "high" },
      }),
    });
    const thoughtText = await readSse(thoughtRes);
    assert(thoughtRes.ok, `thinking request failed: ${thoughtText}`);
    assert(
      lastOcBody.v?.reasoning_effort === "high",
      `chat dialect reasoning_effort not sent: ${JSON.stringify(lastOcBody.v || {}).slice(0, 300)}`
    );
    console.log("ok: thinking request maps to reasoning_effort on the chat dialect");

    const directRes = await fetch(`http://127.0.0.1:${OC_ORCH_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        stream: true,
        messages: [{ role: "user", content: "Pick this model explicitly" }],
      }),
    });
    const directText = await readSse(directRes);
    const directContent = extractStreamedContent(directText);
    assert(directRes.ok, `direct model request failed: ${directText}`);
    assert(
      directContent.includes("OpenCode Go reply via deepseek-v4-flash"),
      `direct model override failed: ${directContent}`
    );
    console.log("ok: selecting deepseek-v4-flash bypasses default and streams via OpenCode Go");

    // Anthropic Messages dialect model on OpenCode Go
    const messagesRes = await fetch(`http://127.0.0.1:${OC_ORCH_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.8-flash",
        stream: true,
        messages: [{ role: "user", content: "Use the messages dialect" }],
        thinking: true,
      }),
    });
    const messagesText = await readSse(messagesRes);
    const messagesContent = extractStreamedContent(messagesText);
    const messagesReasoning = extractStreamedReasoning(messagesText);
    assert(messagesRes.ok, `messages-model request failed: ${messagesText}`);
    assert(
      messagesContent.includes("OpenCode messages reply via qwen3.8-flash"),
      `messages dialect failed: ${messagesContent}`
    );
    assert(
      messagesReasoning.includes("musing"),
      `messages dialect missing thinking: ${messagesReasoning}`
    );
    const thoughtBlock = lastOcBody.v?.thinking;
    assert(
      thoughtBlock?.type === "enabled" && Number.isFinite(thoughtBlock.budget_tokens),
      `messages dialect thinking block not sent: ${JSON.stringify(lastOcBody.v || {}).slice(0, 300)}`
    );
    console.log("ok: /messages dialect (qwen3.8-flash) streams via Anthropic parser with thinking");
    // OpenAI Responses dialect model on OpenCode Go
    const responsesRes = await fetch(`http://127.0.0.1:${OC_ORCH_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        stream: true,
        messages: [{ role: "user", content: "Use the responses dialect" }],
      }),
    });
    const responsesText = await readSse(responsesRes);
    const responsesContent = extractStreamedContent(responsesText);
    assert(responsesRes.ok, `responses-model request failed: ${responsesText}`);
    assert(
      responsesContent.includes("OpenCode responses reply via gpt-5.6-luna"),
      `responses dialect failed: ${responsesContent}`
    );
    console.log("ok: /responses dialect (gpt-5.6-luna) streams via Responses parser");
  } finally {
    orch.kill("SIGTERM");
    mock.close();
    await delay(200);
  }
}

async function main() {
  await runOpenAiPhase();
  await runOpenCodePhase();
  console.log("\nSmoke test passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
