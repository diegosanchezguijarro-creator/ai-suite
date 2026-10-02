# Troubleshooting

## A service won't start

- Open the card's log box — errors from the underlying process appear there.
- **Port already in use**: change the port in **Settings** (e.g. orchestrator → 8789) and restart the service.
- On Windows, use `netstat -ano | findstr "<port>"` to find what's holding a port.

## "Missing API key" / provider errors in chat

- Ensure at least one generative provider key is configured in **Settings**.
- The orchestrator's preferred provider is **OpenCode Go**; set `OPENCODE_GO_API_KEY`.
- Routing/verification needs `OPENROUTER_API_KEY`; without it, the orchestrator falls back to keyword heuristics and skips verification.

## The dashboard shows a blank/grey window

- The dashboard requires the local server on port **3000** — if another program uses it, the window may show nothing. Try `npm run start:headless` from the source folder, or change `dashboardPort` in `%APPDATA%\ai-suite\settings.json` and relaunch.

## The chat can't reach the orchestrator

- Orchestrator must be running first, and it must appear healthy (green dot).
- In chat **Settings**, ensure provider **Local Orchestrator** is selected; the default URL is `http://localhost:8788/v1`.

## I can't install / Windows flags the exe

- The installer is unsigned; Windows SmartScreen may ask for confirmation.
- Click **More info → Run anyway** to proceed.
- For corporate laptops, ask IT to whitelist the publisher or use the portable build from a user folder.

## Nothing happens when I double-click the exe

- Check `%APPDATA%\ai-suite\logs\` if present.
- Kill orphaned servers: open Task Manager, find `AI Suite.exe`, and end those processes.
- If a previous AI Suite window is open, the second launch exits by single-instance lock — check your taskbar.

## Reporting bugs

Open an issue with the log box contents and your OS version at
<https://github.com/diegosanchezguijarro-creator/ai-suite/issues>.
