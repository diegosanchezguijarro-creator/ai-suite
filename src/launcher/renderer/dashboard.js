const state = {
  services: [],
  settings: null,
  links: {},
  poll: null,
}

const $ = (sel) => document.querySelector(sel)

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

async function refresh() {
  try {
    const data = await api('/api/status')
    state.services = data.services
    state.settings = data.settings
    render(data)
  } catch (err) {
    console.error('status failed', err)
  }
}

function render({ services, settings, links, docs }) {
  for (const s of services) {
    const dot = document.querySelector(`[data-status-dot="${s.id}"]`)
    if (dot) {
      dot.className = 'status-dot ' + (s.running ? 'running' : s.stoppedByUser ? 'stopped' : 'unknown')
      if (s.running && !s.healthy) dot.classList.add('spin')
    }
    const portEl = document.querySelector(`[data-meta="${s.id}-port"]`)
    if (portEl) portEl.textContent = `${s.label} · port ${s.port} · ${s.running ? 'running' : 'stopped'}`

    const startBtn = document.querySelector(`[data-action="start"][data-id="${s.id}"]`)
    const stopBtn = document.querySelector(`[data-action="stop"][data-id="${s.id}"]`)
    if (startBtn) { startBtn.disabled = s.running; startBtn.textContent = s.running ? 'Running' : 'Start' }
    if (stopBtn) stopBtn.disabled = !s.running
  }

  const chatLink = document.querySelector('[data-link="chat"]')
  if (chatLink && links) chatLink.href = links.chat
  const healthLink = document.querySelector('[data-link="orchestratorHealth"]')
  if (healthLink && links) healthLink.href = links.orchestratorHealth

  const docsContainer = $('#docs-links')
  docsContainer.innerHTML = ''
  for (const slug of docs || []) {
    const a = document.createElement('a')
    a.href = `/docs/${slug}`
    a.textContent = slug === 'index' ? 'Overview' : slug.charAt(0).toUpperCase() + slug.slice(1)
    docsContainer.appendChild(a)
  }
}

async function act(kind, id, btn) {
  const original = btn.textContent
  btn.disabled = true
  btn.textContent = '…'
  try {
    await api(`/api/services/${id}/${kind}`, { method: 'POST' })
  } catch (err) {
    alert(`Failed to ${kind} ${id}: ${err.message}`)
  } finally {
    btn.disabled = false
    btn.textContent = original
    refresh()
  }
}

document.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-action]')
  if (!target) return
  e.preventDefault()
  await act(target.dataset.action, target.dataset.id, target)
})

/* ---------- Settings modal ---------- */

const PORT_FIELDS = [
  ['dashboardPort', 'Dashboard port'],
  ['orchestratorPort', 'Orchestrator port'],
  ['chatPort', 'Chat port'],
]

const ENV_FIELDS = [
  ['OPENROUTER_API_KEY', 'OpenRouter API key (Mercury routing)'],
  ['OPENCODE_GO_API_KEY', 'OpenCode Go API key (preferred generative)'],
  ['ANTHROPIC_API_KEY', 'Anthropic API key (optional)'],
  ['OPENAI_API_KEY', 'OpenAI API key (optional)'],
  ['OPENROUTER_MODEL', 'Decision model'],
  ['OPENCODE_GO_MODEL', 'OpenCode Go fast model'],
  ['OPENCODE_GO_STRONG_MODEL', 'OpenCode Go strong model'],
]

function openSettings() {
  const modal = $('#settings-modal')
  const s = state.settings || {}
  const ports = $('#ports-fields')
  ports.innerHTML = ''
  for (const [key, label] of PORT_FIELDS) {
    ports.appendChild(fieldNode(key, label, s[key] ?? '', 'number'))
  }
  const envs = $('#env-fields')
  envs.innerHTML = ''
  for (const [key, label] of ENV_FIELDS) {
    const value = s.env?.[key] ?? ''
    const isSecret = /KEY|TOKEN|SECRET/i.test(key)
    const node = fieldNode(`env-${key}`, label, value, 'text')
    const input = node.querySelector('input')
    if (isSecret && value) input.value = value
    input.dataset.envkey = key
    envs.appendChild(node)
  }
  modal.hidden = false
}

function fieldNode(key, label, value, type) {
  const div = document.createElement('div')
  div.className = 'field'
  const lab = document.createElement('label')
  lab.htmlFor = `f-${key}`
  lab.textContent = label
  const input = document.createElement('input')
  input.id = `f-${key}`
  input.type = type
  input.value = value ?? ''
  input.dataset.fieldkey = key
  div.appendChild(lab)
  div.appendChild(input)
  return div
}

function closeSettings() {
  $('#settings-modal').hidden = true
}

async function saveSettings() {
  const patch = { env: {} }
  for (const input of document.querySelectorAll('[data-fieldkey]')) {
    const key = input.dataset.fieldkey
    const val = input.value.trim()
    if (['dashboardPort', 'orchestratorPort', 'chatPort'].includes(key)) {
      if (val) patch[key] = Number(val)
    } else if (/KEY|TOKEN|SECRET/i.test(key)) {
      // Only replace secrets when the user typed something new (returning a
      // masked value untouched is treated as "no change").
      const current = state.settings?.env?.[key] ?? ''
      if (val && val !== current) patch.env[key] = val
    } else if (val) {
      patch.env[key] = val
    }
  }
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify(patch) })
    closeSettings()
    refresh()
  } catch (err) {
    alert(`Save failed: ${err.message}`)
  }
}

$('#btn-settings').addEventListener('click', openSettings)
$('#btn-close-settings').addEventListener('click', closeSettings)
$('#btn-cancel-settings').addEventListener('click', closeSettings)
$('#btn-save-settings').addEventListener('click', saveSettings)
$('#settings-modal').addEventListener('mousedown', (e) => {
  if (e.target.id === 'settings-modal') closeSettings()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSettings()
})

refresh()
state.poll = setInterval(refresh, 3000)
