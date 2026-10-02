import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config();

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripSlash(value) {
  return String(value || "").replace(/\/$/, "");
}

function readOpenCodeAuthKey() {
  const candidates = [
    path.join(os.homedir(), ".local", "share", "opencode", "auth.json"),
    path.join(os.homedir(), ".config", "opencode", "auth.json"),
  ];
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const json = JSON.parse(raw);
      const go = json?.["opencode-go"] || json?.opencodeGo || json?.["opencode_go"];
      const key =
        typeof go === "string" ? go : go?.key || go?.apiKey || go?.api_key || "";
      if (key && typeof key === "string") return key;
      // scan nested values for opencode-go entries
      if (json && typeof json === "object") {
        for (const [k, v] of Object.entries(json)) {
          if (!/opencode[-_]?go/i.test(k)) continue;
          const nested = typeof v === "string" ? v : v?.key || v?.apiKey || "";
          if (nested) return nested;
        }
      }
    } catch {
      // try next path
    }
  }
  return "";
}

const openCodeKey =
  process.env.OPENCODE_GO_API_KEY || readOpenCodeAuthKey() || "";

export const config = {
  port: num(process.env.PORT, 8788),
  decisions: {
    // Primary decision backend: OpenRouter Decisions API with Mercury Decide.
    primary: {
      apiKey: process.env.OPENROUTER_API_KEY || "",
      model: process.env.OPENROUTER_MODEL || "inception/mercury-decide:free",
      url:
        process.env.OPENROUTER_DECISIONS_URL ||
        "https://openrouter.ai/api/alpha/decisions",
      // Free decision endpoints are rate-limited; brief timeout keeps the
      // pipeline responsive and lets the JEV fallback take over quickly.
      timeoutMs: num(process.env.OPENROUTER_DECISIONS_TIMEOUT_MS, 8000),
    },
    // Fallback decision backend: TypeSafe AI JEV via the SystemOne endpoint.
    fallback: {
      apiKey: process.env.TYPESAFE_API_KEY || "",
      model: process.env.JEV_MODEL || "jev-latest",
    },
  },
  generative: {
    provider: (process.env.GENERATIVE_PROVIDER || "").toLowerCase() || null,
    opencodeKey: openCodeKey,
    opencodeModel: process.env.OPENCODE_GO_MODEL || "glm-5.3-flash",
    opencodeBaseUrl: stripSlash(
      process.env.OPENCODE_GO_BASE_URL || "https://opencode.ai/zen/go/v1"
    ),
    opencodeSession: process.env.OPENCODE_GO_SESSION || "",
    anthropicKey: process.env.ANTHROPIC_API_KEY || "",
    anthropicModel: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
    anthropicBaseUrl: stripSlash(
      process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"
    ),
    openaiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    openaiBaseUrl: stripSlash(process.env.OPENAI_BASE_URL || "https://api.openai.com"),
  },
  verification: {
    noulThreshold: num(process.env.VERIFY_NOUL_THRESHOLD, 0.85),
    maxSynthesisAttempts: num(process.env.MAX_SYNTHESIS_ATTEMPTS, 2),
  },
  routing: {
    // JEV/Routing confidence floor: each route option is scored independently,
    // so a bare argmax win can be a coin flip (p ~ 1/3). Below the floor the
    // router escalates to parallel-analysis rather than committing.
    confidenceFloor: num(process.env.ROUTE_CONFIDENCE_FLOOR, 0.5),
  },
  context: {
    charLimit: num(process.env.CONTEXT_CHAR_LIMIT, 48000),
  },
  keepAliveMs: num(process.env.KEEP_ALIVE_MS, 10000),
};

if (config.decisions.fallback.apiKey && !process.env.TYPESAFE_API_KEY) {
  process.env.TYPESAFE_API_KEY = config.decisions.fallback.apiKey;
}
