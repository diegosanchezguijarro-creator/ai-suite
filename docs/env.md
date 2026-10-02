# Environment Variables / API Keys

AI Suite reads keys from (in priority order):

1. The dashboard **Settings** modal (`%APPDATA%\ai-suite\settings.json`)
2. Developer `.env` files inside each app (`apps/orchestrator/.env`, `apps/aichatinterface/.env`)

## Orchestrator decision backend

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | – | Primary: routes and verifies via [Mercury Decide](https://openrouter.ai/inception/mercury-decide:free). |
| `OPENROUTER_MODEL` | `inception/mercury-decide:free` | Alternate decision model slug (e.g. `respan/span-01`). |
| `TYPESAFE_API_KEY` | – | Fallback when OpenRouter is unavailable. |

## Generative LLM backend (planner / workers / synthesis / streaming)

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENCODE_GO_API_KEY` | – | **Preferred provider.** Sub key from <https://opencode.ai/console>. |
| `OPENCODE_GO_MODEL` | `glm-5.3-flash` | Fast model: chat, planner, workers. |
| `OPENCODE_GO_STRONG_MODEL` | `kimi-k2.6` | Strong model: synthesis & rewrites. |
| `ANTHROPIC_API_KEY` | – | Optional Anthropic.googleapis. |
| `OPENAI_API_KEY` | – | Optional OpenAI backend. |
| `GENERATIVE_PROVIDER` | auto | Force `opencode-go`, `anthropic`, or `openai`. |

## Chat interface proxy

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Direct provider keys for the chat UI when not using the orchestrator. |
| `LOCAL_BASE_URL` | For local Ollama / LM Studio endpoints. |
| `ORCHESTRATOR_BASE_URL` | Points the chat UI at the orchestrator. Usually `http://localhost:8788/v1`. |

## Where secrets live

- `%APPDATA%\ai-suite\settings.json` — created by the dashboard, masked in the UI.
- `apps/*/.env` — created from `.env.example` by `npm run prepare:runtime` (dev mode only).
- **Never** inside the installed program folder — Windows keeps that read-only.

## Key safety

- Keys are sent server-side only (never to the browser).
- A custom `baseUrl` from the chat UI can't be used as a key-exfiltration proxy.
- If a key ever leaks, rotate it in the provider's console.
