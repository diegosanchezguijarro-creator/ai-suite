# Installation

## Option A — Installer

1. Download `AI-Suite-Setup-x.y.z.exe` from the [releases page](https://github.com/diegosanchezguijarro-creator/ai-suite/releases).
2. Run it. Choose an install directory (default under your user profile is fine).
3. Optionally create a desktop shortcut.
4. Launch **AI Suite** from the Start menu or desktop shortcut.

Node.js and all npm dependencies are bundled — nothing else to install.

## Option B — Portable

1. Download `AI-Suite-Portable-x.y.z.exe`.
2. Put it anywhere (Desktop, USB stick, etc.) and double-click it.
3. Settings are stored in `%APPDATA%\ai-suite` so they survive moving the file.

## What happens on first launch

- A native window opens pointing at the local dashboard.
- You can immediately **Start** the orchestrator or chat services.
- Adding API keys is optional to launch, but required for real generation:
  - At minimum, set **OpenCode Go API key** (preferred) or **Anthropic/OpenAI**, and
  - **OpenRouter API key** to enable Mercury Decide routing.
  See [Env / API keys](env.md).

## Requirements

- Windows 10 or newer (64-bit)
- ~300 MB free disk space
- No admin rights required unless you install into a protected folder

## Building from source (for developers)

```bash
git clone https://github.com/diegosanchezguijarro-creator/ai-suite.git
cd ai-suite
npm install               # launcher deps
npm run setup             # installs each app's deps
npm run dist              # produces install + portable under /release
```

Node.js 20+ is required only for building — end users don't need it.
