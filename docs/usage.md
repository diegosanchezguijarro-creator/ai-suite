# Usage

## Dashboard

When AI Suite launches, a dashboard opens at `http://localhost:3000` with three cards:

### Orchestrator card
- **Start / Stop** spawns or stops the orchestrator server (`localhost:8788`).
- **Health** opens `http://localhost:8788/healthz` in your browser.
- Live logs of stdout/stderr appear in the card's log box.

### AI Chat card
- **Start / Stop** spawns or stops the chat web server (`localhost:8787`).
- **Open Chat** opens the chat UI in your default browser.
- Chat works fine standalone; pointing it at the orchestrator unlocks routing + multi-layer pipeline features (see below).

### Docs card
- Click any doc to read it inline.

## Using the chat with the orchestrator

1. Start both services.
2. In the chat UI, open **Settings** and pick the **Local Orchestrator** provider. It automatically connects to `localhost:8788/v1`.
3. Pick a model from the orchestrator's list (e.g. `agent-auto`, `agent-fast-chat`, or a curated OpenCode Go model).
4. Enable the backend panel (top-right layers button) to see the pipeline executing live.

## Settings modal

- **Ports**: dashboard/orchestrator/chat — changes apply on the next service start.
- **API keys**: masked after save; saved to `%APPDATA%\ai-suite\settings.json`.
- You can also edit `apps/*/env/.env` files by hand if you prefer plain files.

## Keyboard shortcuts

- `Ctrl+N` new chat (chat app)
- `Ctrl+Shift+E` export conversation (chat app)
- `Escape` closes dialogs (both apps)
