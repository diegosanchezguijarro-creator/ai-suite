# AI Chat Interface

A polished, streaming AI chat web app. React (Vite) frontend + Express proxy server that keeps all API keys server-side and speaks to Anthropic, OpenAI, and any OpenAI-compatible endpoint — including your own local orchestration server.

## Features

- **Streaming chat** with markdown, GFM tables, and syntax-highlighted code blocks
- **Backend activity panel** for every provider: request timeline, resolved endpoint, TTFB, chunk counts, token usage, orchestrator pipeline layers, and a raw SSE event view
- **Multiple providers**: Anthropic, OpenAI, any OpenAI-compatible local endpoint (Ollama, LM Studio, vLLM, llama.cpp…), and a **Local Orchestrator** of your own
- **Files & images**: paste (Ctrl+V), drag-and-drop, or attach screenshots and code files. Images are auto-resized (max 1024px) and streamed to the model; code/files are rendered with syntax highlighting and a click-to-zoom lightbox
- **Chat management**: rename, edit & resend, retry on error, export/import conversations as JSON
- **Keyboard shortcuts**: `Ctrl/Cmd+N` new chat · `Ctrl+Shift+E` export chat · `Escape` close dialogs · `Enter` send · `Shift+Enter` newline
- **Dark/light theme**, per-message token usage
- **Privacy**: conversations persist locally in your browser — attachments are kept in memory only and never saved

## Quick start

```
npm install
cp .env.example .env       # add keys (optional — can also be set in the app's Settings)
npm run dev                # server on :8787 + client on :5173
```

Production build:

```
npm run build
npm start                  # single server on :8787 serving the app
```

## Providers

API keys live in `.env` (server-side, never exposed) or per-session in the app's Settings dialog. The **Local / Compatible** and **Local Orchestrator** providers don't need keys (set one via env if your endpoint requires it).

### Connecting a local orchestration server

The interface can connect to your own locally-run orchestration server that handles model selection, prompt engineering, multi-layer agents, etc. The interface sends it the conversation and streams the finished response back.

**Requirements** — your server must be OpenAI-compatible:

| Endpoint | Method | Behavior |
|---|---|---|
| `/v1/models` | GET | Return `{ "data": [{ "id": "model-id" }, …] }` — shown in the model dropdown |
| `/v1/chat/completions` | POST | Accept standard OpenAI request JSON (including `image_url` content parts), respond with SSE chunks in OpenAI streaming format ending in `data: [DONE]` |

**Configure** the endpoint URL in `.env` (restart the server after changing):

```
ORCHESTRATOR_BASE_URL=http://localhost:8788/v1
ORCHESTRATOR_API_KEY=              # only if your server requires an auth header
```

**Use** it: start your orchestration server, then in the app pick the **Local Orchestrator** provider — the model dropdown loads straight from your server's `/v1/models`, and every message is streamed through your server's pipeline.

### Backend activity panel

The layers button in the top bar opens a diagnostics panel that works with **every** provider:

- **Timeline** — started / endpoint resolved / finished / error entries with timestamps
- **Orchestrator layers** — the pipeline telemetry emitted by your orchestration server (gateway, router, planner, workers, verification, egress)
- **Raw SSE** — the last 200 raw server-sent events, for debugging exactly what the wire carried

Per-message metadata shows input/output tokens, time-to-first-byte, chunk count, and total duration. The server folds a proxy summary (`provider`, `model`, `baseUrl`, chunk/token counts, duration) into the terminal `done` event; API keys and request headers are never exposed to the browser.

Notes on the wire format:

- Images travel as OpenAI `image_url` content parts (data URIs); text stays plain `text` parts
- The `model` field is whatever your `/v1/models` list advertised — use it as a routing hint (e.g. different agent/persona IDs)
- Requests time out / abort cleanly when a message is cancelled in the UI

### Ollama / LM Studio example

Same mechanism, different provider: set `LOCAL_BASE_URL=http://localhost:11434/v1` (Ollama) or `http://localhost:1234/v1` (LM Studio) and pick **Local / Compatible**.

## Project layout

```
server/
  index.js            Express API: /api/chat (SSE proxy), /api/providers, static serving
  providers.js        Provider registry (models, base URLs, auth)
  providers-stream.js Provider adapters: Anthropic & OpenAI wire formats, transforms
src/
  App.jsx             App shell: conversations, send pipeline, shortcuts, settings
  files.js            Attachment processing (resize, validate, content blocks)
  storage.js          Local persistence (attachments stripped from localStorage)
  components/         Composer, ChatMessage, Sidebar, Settings, Markdown, CodeBlock…
```

## Development notes

- `npm run lint` — ESLint (React hooks + refresh rules)
- `npm run build` — Vite production build (uses the wasm rollup override, see `package.json`)
- Node 18+ required (global `fetch`)

## Security model (key-leak hardening)

- **Keys live server-side.** `.env` is read by the Express proxy only; the browser never sees it. `.gitignore` excludes `.env*` so keys can't be committed.
- **Browser-entered keys are session-only.** Keys typed into Settings are kept in `sessionStorage`, never `localStorage`: they're never written to disk, never cached, never included in exported/imported JSON, and die when the tab closes.
- **No keys in URLs.** Keys travel in request bodies or an `x-api-key` header — never in query strings that would land in access logs or browser history.
- **Env keys never leave the physical machine's expected endpoint.** The proxy attaches the provider's `.env` key only when calling that provider's registered base URL. A custom `baseUrl` from the client is honored only for keyless providers (Local / Orchestrator) and receives at most a key the client itself supplied — a crafted URL can't be used as a key-exfiltration proxy.
- **Loopback-only serving.** The server binds `127.0.0.1` (override with `HOST`) so LAN devices can't spend your credits.
- **Strict CORS.** Requests carrying a foreign `Origin` header are rejected with 403 — random web pages, and DNS-rebinding attacks that resolve to localhost, cannot drive the server or read its responses.
- **No caching of API responses.** `/api/*` responses are sent with `Cache-Control: no-store` so nothing sensitive lands in intermediate caches.

## License

MIT
