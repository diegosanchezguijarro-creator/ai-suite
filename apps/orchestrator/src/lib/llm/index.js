import { config } from "../../config.js";
import { strongModel } from "../opencodeModels.js";
import { anthropicGenerate, anthropicStream } from "./anthropic.js";
import { openaiGenerate, openaiStream } from "./openai.js";
import { opencodeGenerate, opencodeStream } from "./opencode.js";

export function resolveProvider() {
  const explicit = config.generative.provider;
  if (explicit === "opencode-go") {
    return config.generative.opencodeKey ? "opencode-go" : null;
  }
  if (explicit === "anthropic") {
    return config.generative.anthropicKey ? "anthropic" : null;
  }
  if (explicit === "openai") {
    return config.generative.openaiKey ? "openai" : null;
  }
  // OpenCode Go is the preferred provider whenever a key is available.
  if (config.generative.opencodeKey) return "opencode-go";
  if (config.generative.anthropicKey) return "anthropic";
  if (config.generative.openaiKey) return "openai";
  return null;
}

const ADAPTERS = {
  "opencode-go": { generate: opencodeGenerate, stream: opencodeStream, strongLookup: strongModel },
  anthropic: { generate: anthropicGenerate, stream: anthropicStream, modelConfig: "anthropicModel" },
  openai: { generate: openaiGenerate, stream: openaiStream, modelConfig: "openaiModel" },
};

/**
 * Builds a generative handle. `role` picks the model:
 *   - "fast" (default): direct chat, planner, parallel workers
 *   - "strong": synthesis and rewrite passes (only OpenCode Go separates these)
 */
export function getGenerative(overrides = {}, role = "fast") {
  const provider = resolveProvider();
  if (!provider) return null;

  const adapter = ADAPTERS[provider];
  const defaultModel =
    provider === "opencode-go"
      ? role === "strong"
        ? strongModel()
        : config.generative.opencodeModel
      : config.generative[adapter.modelConfig];
  const model = overrides.model || defaultModel;

  return {
    provider,
    model,
    generate: (args) => adapter.generate({ ...args, model: args.model || model }),
    stream: (args) => adapter.stream({ ...args, model: args.model || model }),
  };
}

export function missingProviderMessage() {
  return (
    "No generative LLM configured. Set OPENCODE_GO_API_KEY (OpenCode Go), " +
    "ANTHROPIC_API_KEY, or OPENAI_API_KEY (and optionally GENERATIVE_PROVIDER)."
  );
}
