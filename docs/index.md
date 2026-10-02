# AI Suite — Overview

AI Suite bundles two projects into **one installable Windows app**:

| Component | What it does | Default port |
| --- | --- | --- |
| **Orchestrator** | A local orchestration server that layers OpenRouter's Mercury Decide (with JEV fallback) for deterministic routing and draft verification on top of generative LLMs (OpenCode Go preferred). | `8788` |
| **AI Chat Interface** | A polished streaming chat web app with markdown, files/images, and a backend activity panel for every provider. | `8787` |
| **Launcher Dashboard** | Native window served by the installer/runtime where you start/stop services, tail logs, edit settings, and read docs. | `3000` |

## What you get

- `AI-Suite-Setup-x.y.z.exe` — NSIS installer (choose install dir, desktop shortcut)
- `AI-Suite-Portable-x.y.z.exe` — single-file portable build (no install needed)
- Bundled docs that are readable inside the dashboard (no internet required)

## Quick usage

1. Launch **AI Suite**.
2. The dashboard opens at `http://localhost:3000`.
3. Click **Start** on **Orchestrator** (optional — the chat can run without it, but orchestration features need it).
4. Click **Start** on **AI Chat Interface**, then **Open Chat**.
5. Configure API keys under **Settings** (OpenRouter, OpenCode Go, Anthropic, OpenAI).
6. Read the docs right here in the dashboard.

## Repository links

- Combined suite: <https://github.com/diegosanchezguijarro-creator/ai-suite>
- Orchestrator upstream: <https://github.com/diegosanchezguijarro-creator/ai-orchestrator>
- Chat interface upstream: <https://github.com/diegosanchezguijarro-creator/aichatinterface>

## Other docs

- [Installation](install.md)
- [Usage](usage.md)
- [Environment / API keys](env.md)
- [Architecture](architecture.md)
- [Troubleshooting](troubleshooting.md)
