// User settings persisted outside the read-only app bundle so they survive
// updates and reinstallations.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULTS = {
  dashboardPort: 3000,
  orchestratorPort: 8788,
  chatPort: 8787,
  env: {
    // Keys intentionally empty; users fill them via the dashboard or .env files.
    OPENROUTER_API_KEY: '',
    OPENCODE_GO_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    OPENROUTER_MODEL: 'inception/mercury-decide:free',
    OPENCODE_GO_MODEL: 'glm-5.3-flash',
    OPENCODE_GO_STRONG_MODEL: 'kimi-k2.6',
  },
}

export function resolveDataDir(explicit) {
  if (explicit) return explicit
  if (process.env.AI_SUITE_DATA_DIR) return process.env.AI_SUITE_DATA_DIR
  return path.join(os.homedir(), '.ai-suite')
}

export class Settings {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.file = path.join(dataDir, 'settings.json')
    this.settings = { ...DEFAULTS }
    this.load()
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      // Shallow-merge scalars, deep-merge env so new default keys survive upgrades.
      this.settings = {
        ...DEFAULTS,
        ...raw,
        env: { ...DEFAULTS.env, ...(raw?.env ?? {}) },
      }
    } catch {
      // first run or corrupt file: keep defaults, will be saved on first change
    }
    this.settings = {
      ...this.settings,
      _version: '0.1.0',
    }
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true })
    const { _version, ...rest } = this.settings
    fs.writeFileSync(this.file, JSON.stringify({ ...rest, _version }, null, 2))
  }

  get() {
    return this.settings
  }

  update(patch) {
    this.settings = {
      ...this.settings,
      ...patch,
      env: { ...this.settings.env, ...(patch?.env ?? {}) },
    }
    this.save()
    return this.settings
  }

  /** Secrets should not be echoed back in plain text. */
  redacted() {
    const redact = (v) => (v ? `${String(v).slice(0, 4)}…` : '')
    return {
      ...this.settings,
      env: Object.fromEntries(
        Object.entries(this.settings.env).map(([k, v]) => [
          k,
          /KEY|TOKEN|SECRET/i.test(k) ? redact(v) : v,
        ])
      ),
    }
  }
}

export { DEFAULTS }
