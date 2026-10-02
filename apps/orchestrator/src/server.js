import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { chatCompletionsHandler } from "./routes/chatCompletions.js";
import { modelsHandler } from "./routes/models.js";

function sendJsonError(res, status, message) {
  if (res.headersSent) {
    try {
      res.end();
    } catch {
      // ignore
    }
    return;
  }
  res.status(status).json({ error: { message } });
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  // The React frontend runs on a different port (Vite dev server),
  // so permissive CORS is required. Add allowed origins here if you
  // want to lock it down.
  app.use(cors());

  app.use(express.json({ limit: "32mb" }));

  app.get("/healthz", (req, res) => {
    const decision = config.decisions.primary.apiKey
      ? { backend: "openrouter", model: config.decisions.primary.model }
      : config.decisions.fallback.apiKey
        ? { backend: "jev", model: config.decisions.fallback.model }
        : null;
    res.json({
      ok: true,
      port: config.port,
      providerActive:
        Boolean(config.generative.opencodeKey) ? "opencode-go" : null,
      model: config.generative.opencodeModel,
      strongModel: config.decisions.primary.apiKey || Boolean(config.generative.opencodeKey)
        ? process.env.OPENCODE_GO_STRONG_MODEL || "kimi-k2.6"
        : undefined,
      decision,
    });
  });

  app.get("/v1/models", modelsHandler);
  app.post("/v1/chat/completions", chatCompletionsHandler);

  // 404 (JSON, not HTML)
  app.use((req, res) => {
    sendJsonError(res, 404, `Not found: ${req.method} ${req.path}`);
  });

  // Centralized error handler — express.json() errors (400) and anything else.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message || "Internal server error";

    // body-parser specific errors
    if (err.type === "entity.parse.failed") {
      status = 400;
      message = "Request body is not valid JSON";
    } else if (err.type === "entity.too.large") {
      status = 413;
      message = `Request body too large (limit ${err.limit})`;
    } else if (err.type === "charset.unsupported") {
      status = 415;
      message = "Unsupported charset in request body";
    }

    if (status >= 500) {
      console.error(`[express] ${status}: ${err.stack || err.message}`);
    }

    sendJsonError(res, status, message);
  });

  return app;
}

export function startServer() {
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Orchestrator listening on http://localhost:${config.port}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[server] Port ${config.port} is already in use. Stop the other process or set PORT in .env.`
      );
    } else {
      console.error(`[server] ${err.message}`);
    }
    process.exit(1);
  });

  const shutdown = () => {
    console.log("\n[server] shutting down...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return { app, server };
}
