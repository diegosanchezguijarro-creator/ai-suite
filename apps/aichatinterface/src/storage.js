const CONV_KEY = 'aichat.conversations.v1'
const SETTINGS_KEY = 'aichat.settings.v1'

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    console.warn('Could not persist to localStorage', err)
  }
}

export const loadConversations = () => read(CONV_KEY, [])

export const saveConversations = (convs) => write(CONV_KEY, convs)

// API keys must never live in localStorage: it persists forever on disk and is
// readable by any script in the page. sessionStorage keeps keys usable for a
// browsing session but is cleared the moment the tab closes.
const KEYS_KEY = 'aichat.keys.session'

function readSession(key, fallback) {
  try {
    return JSON.parse(sessionStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    console.warn('Could not persist to sessionStorage', err)
  }
}

function migrateKeysFromLocalStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null')
    if (raw?.apiKeys && Object.keys(raw.apiKeys).length) {
      writeSession(KEYS_KEY, { ...readSession(KEYS_KEY, {}), ...raw.apiKeys })
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...raw, apiKeys: {} }))
    }
  } catch {}
}
migrateKeysFromLocalStorage()

export const loadSettings = () => ({
  ...read(SETTINGS_KEY, { localBaseUrl: '', theme: 'light', thinking: false }),
  apiKeys: readSession(KEYS_KEY, {}),
})

export const saveSettings = (s) => {
  writeSession(KEYS_KEY, s.apiKeys || {})
  // Persist settings without the keys.
  write(SETTINGS_KEY, {
    localBaseUrl: s.localBaseUrl || '',
    theme: s.theme || 'light',
    thinking: Boolean(s.thinking),
  })
}

function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
}

function stripContentAttachments(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content
  const textBlocks = content.filter((b) => b.type === 'text')
  if (textBlocks.length === 1) return textBlocks[0].text
  if (textBlocks.length === 0) return ''
  return textBlocks
}

export function stripAttachments(conversations) {
  return conversations.map((conv) => ({
    ...conv,
    messages: conv.messages.map((m) => {
      if (typeof m.content === 'string') return m
      if (!Array.isArray(m.content)) return m
      const hasAttachments = m.content.some((b) => b.type === 'image' || b.type === 'file')
      if (!hasAttachments) return m
      return { ...m, content: stripContentAttachments(m.content) }
    }),
  }))
}

export function titleFrom(messages) {
  const firstUser = messages.find((m) => m.role === 'user')
  if (!firstUser) return 'New chat'
  const text = contentToText(firstUser.content).replace(/\s+/g, ' ').trim()
  if (!text) return 'New chat'
  return text.length > 44 ? text.slice(0, 44) + '…' : text
}
