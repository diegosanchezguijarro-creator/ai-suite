import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import { renderDoc, listDocs } from './docs.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function createDashboardApp({ manager, settings, log, ring = [] }) {
  const app = express()
  app.disable('x-powered-by')

  // Local-only API: an external origin must never drive the launcher.
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin && origin !== `http://localhost:${settings.get().dashboardPort}` && origin !== `http://localhost:` && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return res.status(403).json({ error: 'Cross-origin requests are not allowed' })
    }
    return next()
  })
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/logs', (req, res) => {
    res.json({ lines: ring.slice(-(Number(req.query.tail) || 200)) })
  })

  app.get('/api/status', (req, res) => {
    res.json({
      ok: true,
      services: manager.statusAll(),
      settings: settings.redacted(),
      links: {
        chat: `http://localhost:${settings.get().chatPort}`,
        orchestratorHealth: `http://localhost:${settings.get().orchestratorPort}/healthz`,
      },
      docs: listDocs().files.map((f) => f.slug),
    })
  })

  app.post('/api/services/:id/start', async (req, res) => {
    try {
      const status = await manager.start(req.params.id)
      res.json({ ok: true, service: status })
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) })
    }
  })

  app.post('/api/services/:id/stop', async (req, res) => {
    try {
      const status = await manager.stop(req.params.id)
      res.json({ ok: true, service: status })
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) })
    }
  })

  app.post('/api/settings', (req, res) => {
    try {
      const patch = req.body || {}
      const allowedPorts = {}
      if (patch.dashboardPort != null) allowedPorts.dashboardPort = Number(patch.dashboardPort)
      if (patch.orchestratorPort != null) allowedPorts.orchestratorPort = Number(patch.orchestratorPort)
      if (patch.chatPort != null) allowedPorts.chatPort = Number(patch.chatPort)
      const next = settings.update({ ...patch, ...allowedPorts })
      log('[settings] updated via dashboard')
      res.json({ ok: true, settings: next.redacted() })
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) })
    }
  })

  app.get('/docs/api', (req, res) => {
    const { files } = listDocs()
    res.json({ files })
  })

app.get('/docs/:slug', (req, res) => {
  const doc = renderDoc(req.params.slug)
  if (!doc.ok) return res.status(404).json(doc)
  // Browsers (and the iframe) want HTML — markdown is rendered server-side.
  const wantsJson = String(req.headers.accept || '').includes('application/json')
  if (wantsJson) {
    return res.json({ ok: true, slug: doc.slug, title: doc.title, html: doc.html })
  }
  res.type('html').send(doc.wrapHtml)
})

  // Static dashboard UI
  const staticRoot = path.join(__dirname, 'renderer')
  app.use(express.static(staticRoot))

  // Fallback to index.html for dashboard routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/docs/')) return next()
    res.sendFile(path.join(staticRoot, 'dashboard.html'))
  })

  app.use((err, req, res, _next) => {
    console.error('[dashboard] error:', err?.message)
    if (res.headersSent) return
    res.status(err?.status || 500).json({ error: String(err?.message || 'Internal error') })
  })

  return app
}

export function findFreePort(startPort) {
  return new Promise(async (resolve) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const port = startPort + attempt
      if (await isFree(port)) return resolve(port)
    }
    resolve(startPort)
  })
}

function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}
