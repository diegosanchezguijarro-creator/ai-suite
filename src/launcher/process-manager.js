import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Works identically in dev (project root) and packaged (resources/app)
// because electron-builder is configured with asar: false.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const SERVICES = {
  orchestrator: {
    label: 'Orchestrator',
    script: 'apps/orchestrator/index.js',
    healthPath: '/healthz',
    envKeys: [
      'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_DECISIONS_URL',
      'OPENCODE_GO_API_KEY', 'OPENCODE_GO_MODEL', 'OPENCODE_GO_STRONG_MODEL',
      'OPENCODE_GO_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL',
      'OPENAI_API_KEY', 'OPENAI_MODEL', 'GENERATIVE_PROVIDER',
      'TYPESAFE_API_KEY', 'JEV_MODEL', 'VERIFY_NOUL_THRESHOLD',
      'MAX_SYNTHESIS_ATTEMPTS', 'ROUTE_CONFIDENCE_FLOOR', 'CONTEXT_CHAR_LIMIT',
    ],
  },
  chat: {
    label: 'AI Chat Interface',
    script: 'apps/aichatinterface/server/index.js',
    healthPath: '/api/health',
    envKeys: [
      'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ORCHESTRATOR_API_KEY',
      'ORCHESTRATOR_BASE_URL', 'LOCAL_BASE_URL', 'HOST',
    ],
  },
}

function readDotEnv(dir) {
  const file = path.join(dir, '.env')
  if (!existsSync(file)) return {}
  const out = {}
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(line)
    if (m) out[m[1]] = m[2]
  }
  return out
}

export class ProcessManager {
  constructor({ settings, log }) {
    this.settings = settings
    this.log = log
    this.children = new Map() // id -> { proc, startedAt, stoppedByUser, exitCode, healthy, lastError }
  }

  portFor(id) {
    const s = this.settings.get()
    return id === 'orchestrator' ? s.orchestratorPort : s.chatPort
  }

  buildEnv(id) {
    const cfg = SERVICES[id]
    const saved = this.settings.get().env || {}
    const env = {}

    // 1) dashboard-managed values (user-editable)
    for (const key of cfg.envKeys) {
      if (saved[key] != null && saved[key] !== '') env[key] = saved[key]
    }
    // 2) developer .env in the app folder (wins over dashboard defaults)
    const appDir = path.join(projectRoot, 'apps', id === 'orchestrator' ? 'orchestrator' : 'aichatinterface')
    for (const [k, v] of Object.entries(readDotEnv(appDir))) {
      if (v !== '') env[k] = v
    }
    // 3) wiring
    env.PORT = String(this.portFor(id))
    env.NODE_ENV = env.NODE_ENV || 'production'
    env.ELECTRON_RUN_AS_NODE = '1'  // lets the bundled Electron binary act as plain Node
    if (id === 'chat' && !env.ORCHESTRATOR_BASE_URL) {
      env.ORCHESTRATOR_BASE_URL = `http://127.0.0.1:${this.portFor('orchestrator')}/v1`
    }
    return env
  }

  status(id) {
    const cfg = SERVICES[id]
    const entry = this.children.get(id)
    const running = Boolean(entry?.proc && !entry.proc.killed && entry.exitCode == null)
    return {
      id,
      label: cfg.label,
      running,
      healthy: Boolean(entry?.healthy),
      stoppedByUser: Boolean(entry?.stoppedByUser),
      port: this.portFor(id),
      pid: entry?.proc ? entry.proc.pid : null,
      lastExitCode: entry?.exitCode ?? null,
      lastError: entry?.lastError ?? null,
      startedAt: entry?.startedAt ?? null,
    }
  }

  statusAll() {
    return Object.keys(SERVICES).map((id) => this.status(id))
  }

  async start(id) {
    const cfg = SERVICES[id]
    if (!cfg) throw new Error(`Unknown service: ${id}`)
    const entry = this.children.get(id)
    if (entry?.proc && !entry.proc.killed && entry.exitCode == null) {
      return this.status(id)
    }

    const script = path.join(projectRoot, cfg.script)
    const env = { ...process.env, ...this.buildEnv(id) }

    const proc = spawn(process.execPath, [script], {
      cwd: projectRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.children.set(id, {
      proc, startedAt: Date.now(), stoppedByUser: false, exitCode: null, healthy: false, lastError: null,
    })
    this.log(`[launch] ${cfg.label} starting (pid ${proc.pid}, port ${this.portFor(id)})`)

    proc.stdout.on('data', (d) => {
      for (const line of String(d).split('\n')) if (line.trim()) this.log(`[${cfg.label}] ${line.trimEnd()}`)
    })
    proc.stderr.on('data', (d) => {
      for (const line of String(d).split('\n')) if (line.trim()) this.log(`[${cfg.label}] ${line.trimEnd()}`)
    })
    proc.on('exit', (code, signal) => {
      const rec = this.children.get(id)
      if (rec) {
        rec.exitCode = code
        rec.healthy = false
        rec.lastError = rec.stoppedByUser ? null : `${cfg.label} exited unexpectedly (code ${code})`
      }
      this.log(`[exit] ${cfg.label} code=${code} signal=${signal ?? ''}${rec?.stoppedByUser ? ' (stopped by user)' : ''}`)
    })

    try {
      await this.waitHealthy(id, 20000)
    } catch (err) {
      const rec = this.children.get(id)
      if (rec) rec.lastError = err.message
      throw err
    }
    const rec = this.children.get(id)
    if (rec) rec.healthy = true
    return this.status(id)
  }

  async waitHealthy(id, timeoutMs) {
    const cfg = SERVICES[id]
    const port = this.portFor(id)
    const url = `http://127.0.0.1:${port}${cfg.healthPath}`
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const ok = await probe(url).catch(() => false)
      if (ok) return true
      await new Promise((r) => setTimeout(r, 250))
    }
    return probe(url).then((v) => {
      if (v) return true
      throw new Error(`${cfg.label} did not become healthy on ${url} within ${Math.round(timeoutMs / 1000)}s`)
    })
  }

  async stop(id) {
    const entry = this.children.get(id)
    if (!entry?.proc) return this.status(id)
    entry.stoppedByUser = true
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        try { entry.proc.kill('SIGKILL') } catch {}
        resolve()
      }, 4000)
      entry.proc.once('exit', () => { clearTimeout(t); resolve() })
      try { entry.proc.kill('SIGTERM') } catch { clearTimeout(t); resolve() }
    })
    return this.status(id)
  }

  async stopAll() {
    for (const id of Object.keys(SERVICES)) {
      if (this.children.get(id)) await this.stop(id)
    }
  }
}

function probe(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(res.statusCode >= 200 && res.statusCode < 500)
    })
    req.on('error', reject)
    req.setTimeout(2000, () => {
      req.destroy()
      reject(new Error('timeout'))
    })
  })
}
