import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCore } from '../src/core.js'

const ORCH_PORT = 18788
const CHAT_PORT = 18787
const DASH_PORT = 13000

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, {}, (res) => {
      let body = ''
      res.on('data', (d) => (body += d))
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function post(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { 'content-length': 0 } }, (res) => {
      let body = ''
      res.on('data', (d) => (body += d))
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

function assert(cond, msg) {
  if (!cond) throw new Error(`smoke: ${msg}`)
}

async function main() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ai-suite-smoke-'))
  console.log(`[smoke] data dir: ${dataDir}`)

  const log = (...a) => console.log(...a)
  const core = await createCore({ dataDir, log })

  // Point services at isolated smoke ports through settings before starting.
  core.settings.update({ dashboardPort: DASH_PORT, orchestratorPort: ORCH_PORT, chatPort: CHAT_PORT })
  await core.start()
  console.log('[smoke] dashboard:', `http://127.0.0.1:${core.dashboardPort()}`)

  const DASH = core.dashboardPort()

  let res = await get(`http://127.0.0.1:${DASH}/api/status`)
  assert(res.status === 200, 'status 200')
  const st = JSON.parse(res.body)
  assert(st.ok === true, 'status ok')
  assert((st.docs || []).includes('install'), 'docs list includes install')

  res = await post(`http://127.0.0.1:${DASH}/api/services/orchestrator/start`)
  assert(res.status === 200, `orchestrator start ${res.status}: ${res.body}`)
  console.log('[smoke] orchestrator started:', JSON.parse(res.body).service.healthy)

  const orchHealth = await get(`http://127.0.0.1:${ORCH_PORT}/healthz`)
  assert(orchHealth.status === 200, `orchestrator /healthz ${orchHealth.status}`)
  assert(JSON.parse(orchHealth.body).ok === true, 'orchestrator healthz ok:true')
  console.log('[smoke] orchestrator /healthz ok')

  res = await post(`http://127.0.0.1:${DASH}/api/services/chat/start`)
  assert(res.status === 200, `chat start ${res.status}: ${res.body}`)
  console.log('[smoke] chat started:', JSON.parse(res.body).service.healthy)

  const chatHealth = await get(`http://127.0.0.1:${CHAT_PORT}/api/health`)
  assert(chatHealth.status === 200, `chat /api/health ${chatHealth.status}`)
  assert(JSON.parse(chatHealth.body).ok === true, 'chat health ok:true')
  console.log('[smoke] chat /api/health ok')

  const docsIndex = await get(`http://127.0.0.1:${DASH}/docs/index`)
  assert(docsIndex.status === 200 && docsIndex.body.includes('<html'), 'docs index renders html')
  const dashIndex = await get(`http://127.0.0.1:${DASH}/`)
  assert(dashIndex.status === 200 && dashIndex.body.includes('AI Suite'), 'dashboard html served')
  console.log('[smoke] docs + dashboard html served')

  await core.shutdown()
  console.log('\n[smoke] PASSED')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
