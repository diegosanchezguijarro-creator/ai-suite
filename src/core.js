import http from 'node:http'
import { ProcessManager } from './launcher/process-manager.js'
import { Settings } from './launcher/settings.js'
import { createDashboardApp, findFreePort } from './launcher/server.js'

export async function createCore({ dataDir, log = console.log } = {}) {
  const settings = new Settings(dataDir)
  const ring = []                       // { line }
  const logger = (...args) => {
    const text = args.join(' ')
    ring.push({ line: text })
    if (ring.length > 800) ring.splice(0, ring.length - 800)
    log(text)
  }
  const manager = new ProcessManager({ settings, log: logger })

  let aPort = settings.get().dashboardPort
  let app = null

  const start = async () => {
    aPort = await findFreePort(settings.get().dashboardPort)
    app = createDashboardApp({ manager, settings, log: logger, ring })
    await new Promise((resolve, reject) => {
      app.listen(aPort, '127.0.0.1', () => {
        logger(`[dashboard] listening on http://localhost:${aPort}`)
        resolve()
      }).on('error', reject)
    })
    return aPort
  }

  const shutdown = async () => {
    logger('[launcher] shutting down services…')
    await manager.stopAll()
  }

  return { settings, manager, app, start, shutdown, dashboardPort: () => aPort, ring }
}

/** Headless mode (no Electron window): used for dev and server-style usage. */
export async function runHeadless({ dataDir } = {}) {
  const log = (...args) => console.log(...args)
  const core = await createCore({ dataDir, log })
  await core.start()
  log('[launcher] headless mode — dashboard ready. Press Ctrl+C to quit.')
  const keepAlive = setInterval(() => {}, 1 << 30)
  const bye = async () => {
    clearInterval(keepAlive)
    await core.shutdown()
    process.exit(0)
  }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
  return core
}

import { resolveDataDir } from './launcher/settings.js'

export function defaultDataDir() {
  return resolveDataDir()
}
