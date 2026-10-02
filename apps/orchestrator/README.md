# AI Orchestrator

A local orchestration server that sits between an OpenAI-compatible chat frontend (e.g.
[aichatinterface](https://github.com/diegosanchezguijarro-creator/aichatinterface)) and
generative LLM providers. It layers OpenRouter's
[Mercury Decide](https://openrouter.ai/inception/mercury-decide:free) decision model on
top of generative LLMs for deterministic routing (Layer 2) and draft verification
(Layer 5), while generative models handle planning, parallel sub-tasks, and synthesis.
TypeSafe AI's JEV remains as an automatic fallback for the decision layers.

Focused on **general chat, creative writing, analysis, and multi-step reasoning**.
No coding tasks, terminal execution, or filesystem access.

## Quick start

```bash
npm install
cp .env.example .env    # add your API keys
npm start               # http://localhost:8788
```

Point your frontend at:

```
ORCHESTRATOR_BASE_URL=http://localhost:8788/v1
```

## Getting an OpenCode Go API key

1. Go to <https://opencode.ai/console> → **API Keys**.
2. Create an API key (requires an OpenCode Go / Zen subscription).
3. Put it in `.env` as `OPENCODE_GO_API_KEY=...`.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8788` | HTTP port |
| `OPENCODE_GO_API_KEY` | – | OpenCode Go subscription key (preferred provider) |
| `OPENCODE_GO_MODEL` | `glm-5.3-flash` | Fast Go model (chat, planner, workers) |
| `OPENCODE_GO_STRONG_MODEL` | `kimi-k2.6` | Strong Go model (synthesis, rewrites) |
| `OPENCODE_GO_BASE_URL` | `https://opencode.ai/zen/go/v1` | Go API base URL |
| `OPENCODE_GO_SESSION` | auto | Stable `x-opencode-session` id (helps prompt caching) |
| `GENERATIVE_PROVIDER` | auto | Force `opencode-go`, `anthropic`, or `openai` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | – | Anthropic backend |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | – | OpenAI backend |
| `OPENROUTER_API_KEY` | – | OpenRouter Decisions API (preferred decision backend) |
| `OPENROUTER_MODEL` | `inception/mercury-decide:free` | Decision model slug |
| `OPENROUTER_DECISIONS_TIMEOUT_MS` | `8000` | Decision call timeout before falling back |
| `TYPESAFE_API_KEY` | – | TypeSafe AI (JEV) fallback — used only when OpenRouter fails |
| `VERIFY_NOUL_THRESHOLD` | `0.85` | Parallel-analysis rewrite threshold |
| `MAX_SYNTHESIS_ATTEMPTS` | `2` | Max rewrite attempts in verification loop |
| `ROUTE_CONFIDENCE_FLOOR` | `0.5` | Below this, router escalates to parallel-analysis |
| `CONTEXT_CHAR_LIMIT` | `48000` | Context pruning budget (chars) |
| `KEEP_ALIVE_MS` | `10000` | SSE keep-alive interval during parallel-analysis phases |

## Endpoints

### `GET /v1/models`

Returns a merged list: the static orchestrator **agents** plus a curated list of
OpenCode Go models when `OPENCODE_GO_API_KEY` is set.

- `agent-auto` — Mercury decides the route
- `agent-fast-chat` → general-chat pipeline (streams directly)
- `agent-creative-writer` → creative-writing pipeline (streams directly)
- `agent-parallel-thinker` / `agent-analyst` → parallel-analysis pipeline (buffer → verify → stream)
- Curated OpenCode Go ids (e.g. `glm-5.3-flash`, `kimi-k2.6`) → stream directly with that model, bypassing routing

### `POST /v1/chat/completions`

Accepts standard OpenAI JSON (including `stream: true` and `image_url` data-URI
content parts) and returns standard SSE chunks ending in `data: [DONE]`.
Keep-alive comments (`: keep-alive`) and empty deltas are emitted during the
blocking parallel-analysis phases.

### `GET /healthz`

Returns `ok`, the active generative provider/model, the strong model used for
synthesis, and the active decision backend (`openrouter` or `jev`).

## The 6-layer pipeline

1. **Gateway** — parse/normalize the payload, wire client disconnect to an `AbortSignal`.
2. **Router** — if the UI selected a named agent, skip the decision model and use its fixed route.
   If `agent-auto` (or an unknown id), ask Mercury Decide a `choice` question over the
   conversation to pick `general-chat` / `creative-writing` / `parallel-analysis`.
   Identical prompts reuse a short-lived routing cache; on error or rate limit,
   fall back to JEV (if configured) and then keyword heuristics.
3. **Augmenter** — inject a route-specific system prompt plus a hidden
   "Output in valid Markdown" constraint; prune older messages over the char budget.
4. **Agentic parallel planner** (parallel-analysis only) — a planner LLM emits a JSON
   array of 2–4 sub-tasks; workers run concurrently via `Promise.all` on the fast
   model; a synthesizer weaves the outputs into a single draft on the strong model.
5. **Verification** (parallel-analysis only) — Mercury `noul` ("Does this draft directly
   and accurately answer the user's original prompt?") and `score` (tone/helpfulness 0–10).
   If `noul < VERIFY_NOUL_THRESHOLD`, the draft is rewritten (with reviewer feedback) up to
   `MAX_SYNTHESIS_ATTEMPTS` times, then emitted regardless, with a warning logged.
   Low-stakes routes skip verification entirely and stream directly (fast TTFT).
6. **Egress** — the final (possibly buffered) output is streamed as standard OpenAI SSE
   chunks ending in `data: [DONE]`.

## Project layout

```
src/
  config.js               env loading (incl. auth.json fallback for OpenCode Go)
  server.js               express app, CORS, centralized JSON error handler, /healthz
  agents.js               agent → route map + /v1/models agent list
  routes/
    models.js             GET /v1/models (agents + curated Go models)
    chatCompletions.js    POST /v1/chat/completions entry
  services/
    gateway.js            Layer 1: parse + abort wiring
    router.js             Layer 2: Mercury choice / agent map / direct model
    augmenter.js          Layer 3: system prompts + context pruning
    planner.js            Layer 4: planner → Promise.all workers → synthesizer
    verification.js       Layer 5: noul + score, rewrite loop
    pipeline.js           orchestration glue
  lib/
    sse.js                OpenAI SSE chunk writer, keep-alives, flushing
    context.js (in augmenter)   char-based pruning
    fallbackRouter.js     keyword heuristic when the decision model is unavailable
    routeCache.js         short-lived routing decision cache
    jev.js                decision client: OpenRouter Mercury primary, JEV fallback
    opencodeModels.js     curated Go model list with cache + static fallback
    llm/
      index.js            provider factory (opencode-go → anthropic → openai), fast/strong roles
      opencode.js         OpenCode Go adapter (chat/messages/responses dialects)
      anthropic.js        Anthropic Messages adapter
      openai.js           OpenAI Chat Completions adapter
      normalize.js        message/image normalization helpers
```

## Scripts

```bash
npm run dev      # node --watch, auto-restart on change
npm run lint     # node --check over all sources
npm run smoke    # end-to-end mock tests (OpenAI + OpenCode Go dialects)
```

## Notes

- **Privacy**: conversations are not persisted server-side; the server only holds a
  short-lived session-id cache for prompt caching.
- **Go traffic hygiene**: requests send `User-Agent: ai-orchestrator/0.1.0` and a stable
  `x-opencode-session` per conversation, as recommended in the
  [Go docs](https://opencode.ai/docs/go).
- **Key safety**: never commit `.env`. If a key ever lands in a shared file, rotate it in
  the OpenCode console.

## License

MIT
