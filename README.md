AI Suite combines two local AI projects into **one installable Windows app**:

- **ai-orchestrator** — a local OpenAI-compatible orchestration server that layers Mercury Decide routing (with JEV fallback) and a 6-layer pipeline on top of generative LLMs (OpenCode Go preferred).
- **aichatinterface** — a streaming chat web app with markdown, files/images and a backend activity panel for every provider.

One executable opens a dashboard at `http://localhost:3000` where you can start/stop both services, tail their logs, edit settings/API keys, and read the bundled docs.

## Download

Grab `AI-Suite-Setup-x.y.z.exe` (installer) or `AI-Suite-Portable-x.y.z.exe` (portable) from [Releases](https://github.com/diegosanchezguijarro-creator/ai-suite/releases).

- Windows 10+ (64-bit)
- No Node.js required — everything is bundled
- API keys added via the dashboard (stored in `%APPDATA%\ai-suite\settings.json`)

## Quick start (from source)

```bash
npm install               # launcher deps
npm run setup             # installs each app's deps (requires Node 20+)
npm run start             # headless dashboard on :3000 (dev-style)
npm run start:electron    # desktop window
npm run dist              # builds NSIS installer + portable exe into /release
```

## Panels

| Card | Action | Endpoint |
|---|---|---|
| Orchestrator | Start/Stop · Health | `:8788/healthz` |
| AI Chat | Start/Stop · Open in browser | `:8787` |
| Docs | Read install/usage/env/architecture docs inline | `/docs/<slug>` |

## Related repos

- <https://github.com/diegosanchezguijarro-creator/ai-orchestrator> — upstream orchestrator
- <https://github.com/diegosanchezguijarro-creator/aichatinterface> — upstream chat interface

## License

MIT
