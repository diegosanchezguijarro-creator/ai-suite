import 'dotenv/config'
import express from 'express'
import compression from 'compression'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listProviders, getProvider } from './providers.js'
import { streamChat } from './providers-stream.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 8787
// Bind to loopback by default so the machine's API keys aren't usable from
// other devices on the network. Set HOST=0.0.0.0 to expose deliberately.
const HOST = process.env.HOST || '127.0.0.1'
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i

// Node hides the useful part of network failures on `cause` (e.g. ECONNREFUSED).
function describeError(e) {
  const cause = e?.cause
  const detail = cause?.code ? `${cause.code}: ${cause.message || ''}`.trim() : cause?.message
  return detail ? `${e.message} — ${detail}` : e?.message || 'Unknown error'
}

// Reject any request carrying a foreign Origin header: this server holds real
// provider credentials, and a random web page must never be able to drive it
// (or a DNS-rebinding page pretending to be on localhost either).
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && !LOCAL_ORIGIN.test(origin)) {
    return res.status(403).json({ error: 'Cross-origin requests are not allowed' })
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', origin || 'null')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-api-key')
    return res.sendStatus(204)
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  if (req.url.startsWith('/api')) res.setHeader('Cache-Control', 'no-store')
  return next()
})

app.use(compression())
app.use(express.json({ limit: '50mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/providers', (_req, res) => {
  res.json({ providers: listProviders() })
})

app.get('/api/providers/:id/models', async (req, res) => {
  const provider = getProvider(req.params.id)
  if (!provider) return res.status(404).json({ error: 'Unknown provider' })

  if (!provider.dynamicModels) {
    return res.json({ models: provider.models })
  }

  const apiKey = req.headers['x-api-key'] || ''
  const requestedBase = (req.query.baseUrl || provider.baseUrl).replace(/\/+$/, '')
  const defaultBase = provider.baseUrl.replace(/\/+$/, '')

  // The server's env key is only ever attached when talking to the provider's
  // registered base URL. Custom/redirected endpoints get at most a key the
  // client itself supplied — never the real credentials.
  const onDefaultBase = requestedBase === defaultBase
  const baseUrl = onDefaultBase ? defaultBase : requestedBase
  const effectiveKey =
    apiKey || (onDefaultBase ? process.env[provider.envKey] || '' : '')

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: effectiveKey ? { authorization: `Bearer ${effectiveKey}` } : {},
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const json = await response.json()
    const models = (json.data || json.models || [])
      .map((m) => ({ id: m.id, label: m.id }))
      .sort((a, b) => a.id.localeCompare(b.id))
    res.json({ models })
  } catch (e) {
    res.json({ models: [], error: `Could not reach ${baseUrl}: ${e.message}` })
  }
})

app.post('/api/chat', async (req, res) => {
  const { provider = 'anthropic', model, messages = [], apiKey, baseUrl, temperature, maxTokens, thinking } =
    req.body || {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' })
  }
  if (!model) return res.status(400).json({ error: 'model is required' })

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })

  const send = (data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // Listen on the response, not the request: `req` emits 'close' as soon as
  // express.json() has drained the body, which would abort the stream instantly.
  const upstream = new AbortController()
  let clientGone = false
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true
      upstream.abort()
    }
  })

  const startedAt = Date.now()

  try {
    send({ type: 'start', provider, model, ts: startedAt })
    let chunkCount = 0
    let inputTokens
    let outputTokens
    for await (const event of streamChat({
      providerId: provider,
      messages,
      model,
      apiKey,
      baseUrl,
      temperature,
      maxTokens,
      thinking,
      signal: upstream.signal,
    })) {
      if (clientGone) break
      if (event.type !== 'meta' && event.type !== 'done') chunkCount++
      if (event.type === 'usage') {
        inputTokens = event.input ?? inputTokens
        outputTokens = event.output ?? outputTokens
      }
      // The adapter's trailing proxy.done summary is folded into our done
      // envelope so the UI gets one terminal event with full diagnostics.
      if (event.type === 'meta' && event.meta?.object === 'proxy.done') continue
      send(event)
    }
    if (!clientGone) {
      send({
        type: 'done',
        durationMs: Date.now() - startedAt,
        chunkCount,
        inputTokens,
        outputTokens,
      })
    }
  } catch (e) {
    if (!clientGone && e.name !== 'AbortError') {
      send({ type: 'error', error: describeError(e) })
    }
  } finally {
    if (!res.writableEnded) res.end()
  }
})

const distDir = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

app.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`)
})