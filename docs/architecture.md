# Architecture

```
ai-suite/
├── apps/
│   ├── orchestrator/          ← copied source of ai-orchestrator
│   └── aichatinterface/       ← copied source of aichatinterface
├── src/
│   ├── main.js                ← Electron main process
│   ├── core.js                ← shared core: settings + process manager + server
│   └── launcher/
│       ├── server.js          ← Express dashboard API
│       ├── process-manager.js ← spawns/kills service child processes
│       ├── settings.js        ← persists to %APPDATA%/ai-suite
│       ├── docs.js            ← markdown → HTML rendering
│       ├── run-headless.mjs   ← CLI/dev runner (no window)
│       └── renderer/          ← dashboard HTML/CSS/JS
├── docs/                      ← bundled documentation
├── scripts/                   ← setup, prepare, smoke
└── electron-builder.yml       ← NSIS + portable configuration
```

## Runtime flow

1. `AI Suite.exe` starts the **Electron main** process.
2. Main imports **core.js**, which instantiates:
   - `Settings` (env vars & ports)
   - `ProcessManager` (child processes)
   - Dashboard Express app on `127.0.0.1:3000`
3. Main opens a BrowserWindow pointing at the dashboard.
4. Dashboard JS talks to `/api/status`, `/api/services/:id/start|stop`, `/api/settings`, `/docs/:slug`.
5. Clicking **Start** triggers a spawn of
   - `node apps/orchestrator/index.js` with env built from settings + `apps/*/.env`
   - `node apps/aichatinterface/server/index.js` (serves pre-built `dist/`)
6. A health probe (`/healthz`, `/api/health`) flips the dot green when the service is ready.
7. Quitting AI Suite stops both services.

## Packaged runtime layout (after install)

Electron packs source and dependencies into an `app.asar`. Folders the runtime
actually needs are unpacked next to it as `runtime/`:

```
resources/
├── app.asar
├── runtime/
│   ├── orchestrator/          ← orchestrator code (with deps resolved via asar node_modules)
│   └── aichatinterface/
│       ├── server/            ← proxy server sources
│       └── dist/              ← built React static assets
└── docs/                      ← bundled markdown docs
```

Larger `node_modules` (electron's bundled Node runtime includes express) is resolved
from inside `app.asar` via automatic asar fallback for `require`.

## Security model

- Dashboard binds to `127.0.0.1` only; non-local origins are rejected.
- Secrets are never sent to the browser as plain text — the settings API returns masked values.
- Child services inherit the same security posture as their upstream projects:
  - Orchestrator: conversation not persisted server-side, LAN-safe loopback.
  - Chat: keys live server-side (`127.0.0.1` binding), session-only browser-entered keys.
