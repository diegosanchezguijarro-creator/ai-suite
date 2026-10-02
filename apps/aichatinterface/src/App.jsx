import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar.jsx'
import { Composer } from './components/Composer.jsx'
import { ChatMessage } from './components/ChatMessage.jsx'
import { Settings } from './components/Settings.jsx'
import { OrchestratorPanel } from './components/OrchestratorPanel.jsx'
import { IconMenu, IconClose, IconLayers } from './components/Icons.jsx'
import { fetchProviders, fetchModels, streamChat } from './api.js'
import {
  uid,
  titleFrom,
  loadConversations,
  saveConversations,
  loadSettings,
  saveSettings,
  stripAttachments,
} from './storage.js'
import { contentToText } from './files.js'

const SUGGESTIONS = [
  {
    title: 'Explain a concept',
    sub: 'Explain how HTTP streaming works, simply.',
    prompt: 'Explain how HTTP server-sent events (SSE) work, as if I had never heard of them.',
  },
  {
    title: 'Write some code',
    sub: 'Build a debounce function in TypeScript.',
    prompt: 'Write a debounce function in TypeScript with full type safety and JSDoc comments.',
  },
  {
    title: 'Review a snippet',
    sub: 'Get feedback on code you already have.',
    prompt: 'I will paste a code snippet — review it for bugs and readability.',
  },
  {
    title: 'Plan something',
    sub: 'Break a goal into concrete steps.',
    prompt: 'Help me plan how to learn the basics of machine learning in eight weeks.',
  },
]

export default function App() {
  const [providers, setProviders] = useState([])
  const [modelsByProvider, setModelsByProvider] = useState({})
  const [settings, setSettings] = useState(loadSettings)
  const [conversations, setConversations] = useState(loadConversations)
  const [activeId, setActiveId] = useState(null)
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [serverStatus, setServerStatus] = useState('checking')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [orchestratorPanelOpen, setOrchestratorPanelOpen] = useState(false)
  const [orchestratorMeta, setOrchestratorMeta] = useState({})
  const [backendLog, setBackendLog] = useState({})
  const [rawLog, setRawLog] = useState({})
  const [streamChunks, setStreamChunks] = useState(0)
  const [attachments, setAttachments] = useState([])

  const abortRef = useRef(null)
  const scrollRef = useRef(null)

  const active = conversations.find((c) => c.id === activeId) || null

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme)
  }, [settings.theme])

  useEffect(() => {
    saveConversations(stripAttachments(conversations))
  }, [conversations])

  const apiKeyFor = useCallback(
    (providerId) => settings.apiKeys?.[providerId] || '',
    [settings.apiKeys]
  )

  const baseUrlFor = useCallback(
    (providerId) =>
      providerId === 'local' && settings.localBaseUrl?.trim()
        ? settings.localBaseUrl.trim()
        : undefined,
    [settings.localBaseUrl]
  )

  const loadModels = useCallback(
    async (providerId) => {
      try {
        const { models, error } = await fetchModels(
          providerId,
          apiKeyFor(providerId),
          baseUrlFor(providerId)
        )
        if (models?.length) {
          setModelsByProvider((m) => ({ ...m, [providerId]: models }))
        } else if (error) {
          console.warn(error)
        }
      } catch (e) {
        console.warn(e)
      }
    },
    [apiKeyFor, baseUrlFor]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/health')
        setServerStatus(res.ok ? 'ok' : 'down')
        const { providers: list } = await fetchProviders()
        if (cancelled) return
        setProviders(list)

        const preferred =
          list.find((p) => p.id === 'orchestrator' && p.hasServerKey) ||
          list.find((p) => p.id === 'orchestrator') ||
          list.find((p) => p.hasServerKey && p.id !== 'local') ||
          list[0]
        if (!preferred) return

        const models = preferred.models?.length
          ? preferred.models
          : (await fetchModels(preferred.id, loadSettings().apiKeys?.[preferred.id])).models || []
        if (cancelled) return
        if (models.length) {
          setModelsByProvider((m) => ({ ...m, [preferred.id]: models }))
        }
        setConversations((prev) => {
          if (prev.length) return prev
          return [
            {
              id: uid(),
              title: 'New chat',
              messages: [],
              provider: preferred.id,
              providerLabel: preferred.label,
              model: models[0]?.id || '',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ]
        })
      } catch {
        setServerStatus('down')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Keep a conversation selected.
  useEffect(() => {
    if (!conversations.length) {
      const fallback = providers[0]
      if (!fallback) return
      setConversations([
        {
          id: uid(),
          title: 'New chat',
          messages: [],
          provider: fallback.id,
          providerLabel: fallback.label,
          model: modelsByProvider[fallback.id]?.[0]?.id || '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ])
      return
    }
    if (!conversations.some((c) => c.id === activeId)) setActiveId(conversations[0].id)
  }, [conversations, activeId, providers, modelsByProvider])

  const loadModelsFor = useCallback(
    (providerId) => {
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) return
      if (provider.models?.length) {
        setModelsByProvider((m) => ({ ...m, [providerId]: provider.models }))
      } else if (!modelsByProvider[providerId]) {
        loadModels(providerId)
      }
    },
    [providers, modelsByProvider, loadModels]
  )

  const updateConversation = useCallback((id, patch) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c))
    )
  }, [])

  const patchMessage = useCallback((convId, msgId, patch) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId
              ? typeof patch === 'function'
                ? { ...m, ...patch(m) }
                : { ...m, ...patch }
              : m
          ),
        }
      })
    )
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const lastMessage = active?.messages[active.messages.length - 1]
  useEffect(() => {
    scrollToBottom()
  }, [lastMessage?.content, lastMessage?.thinking, isStreaming, activeId, scrollToBottom])

  const runStream = useCallback(
    (convId, history, providerId, modelId) => {
      const assistantId = uid()
      const startedAt = performance.now()
      let firstChunkAt = null
      let chunkCount = 0
      let providerLabel = providerId

      if (providerId === 'orchestrator') {
        setOrchestratorMeta((prev) => ({ ...prev, [convId]: [] }))
      }
      setBackendLog((prev) => ({ ...prev, [convId]: [] }))
      setRawLog((prev) => ({ ...prev, [convId]: [] }))
      setStreamChunks(0)

      const log = (entry) => {
        setBackendLog((prev) => ({
          ...prev,
          [convId]: [...(prev[convId] || []), entry],
        }))
      }

      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                updatedAt: Date.now(),
                messages: [
                  ...c.messages,
                  { id: assistantId, role: 'assistant', content: '', model: modelId },
                ],
              }
            : c
        )
      )
      setIsStreaming(true)

      abortRef.current = streamChat(
        {
          provider: providerId,
          model: modelId,
          messages: history,
          apiKey: apiKeyFor(providerId),
          baseUrl: baseUrlFor(providerId),
          // Off by default; opt in via Settings → Extended thinking. Only
          // reasoning-capable models return thinking deltas.
          thinking: settings.thinking ? { enabled: true } : undefined,
          onRawEvent: (event) => {
            setRawLog((prev) => ({
              ...prev,
              [convId]: [...(prev[convId] || []).slice(-199), event],
            }))
          },
        },
        (event) => {
          if (event.type === 'start') {
            providerLabel = event.provider || providerId
            log({ time: Date.now(), kind: 'start', provider: event.provider, model: event.model })
            return
          }
          if (event.type !== 'done') {
            chunkCount++
            if (firstChunkAt === null) firstChunkAt = performance.now()
          }
          setStreamChunks(chunkCount)
          if (event.type === 'thinking') {
            patchMessage(convId, assistantId, (m) => ({ thinking: (m.thinking || '') + event.text }))
          } else if (event.type === 'text') {
            patchMessage(convId, assistantId, (m) => ({ content: m.content + event.text }))
          } else if (event.type === 'usage') {
            patchMessage(convId, assistantId, (m) => ({
              inputTokens: event.input ?? m.inputTokens,
              outputTokens: event.output ?? m.outputTokens,
            }))
          } else if (event.type === 'meta') {
            const meta = event.meta
            if (meta?.object === 'proxy.request') {
              log({
                time: Date.now(),
                kind: 'request',
                provider: meta.provider,
                model: meta.model,
                baseUrl: meta.baseUrl,
              })
            } else if (meta?.object?.startsWith('orchestrator.')) {
              setOrchestratorMeta((prev) => ({
                ...prev,
                [convId]: [...(prev[convId] || []), meta],
              }))
              patchMessage(convId, assistantId, (m) => ({
                layers: [...(m.layers || []), meta],
              }))
              log({
                time: Date.now(),
                kind: 'layer',
                layer: meta.layer,
                status: meta.status,
                detail: meta.route || meta.reason || meta.message,
              })
            }
          } else if (event.type === 'error') {
            patchMessage(convId, assistantId, () => ({
              content: event.error,
              error: true,
              diagnostics: finishDiagnostics({ error: event.error }),
            }))
            log({ time: Date.now(), kind: 'error', detail: event.error })
            setIsStreaming(false)
          } else if (event.type === 'done') {
            patchMessage(convId, assistantId, () => ({
              diagnostics: { ...finishDiagnostics(), inputTokens: event.inputTokens, outputTokens: event.outputTokens },
            }))
            log({
              time: Date.now(),
              kind: 'done',
              detail: `${event.durationMs ?? Math.round(performance.now() - startedAt)}ms · ${event.chunkCount ?? chunkCount} chunks`,
            })
            setIsStreaming(false)
          }

          function finishDiagnostics(extra = {}) {
            return {
              provider: providerLabel,
              model: modelId,
              ttfbMs: firstChunkAt != null ? Math.round(firstChunkAt - startedAt) : null,
              totalMs: Math.round(performance.now() - startedAt),
              chunkCount,
              ...extra,
            }
          }
        }
      )
    },
    [apiKeyFor, baseUrlFor, patchMessage, settings.thinking]
  )

  const send = useCallback(
    (text) => {
      const trimmed = text.trim()
      if (!trimmed && attachments.length === 0) return
      if (isStreaming) return

      const convId = activeId || conversations[0]?.id
      if (!convId) return

      const conversation = conversations.find((c) => c.id === convId)
      if (!conversation) return

      const content =
        attachments.length > 0
          ? [
              ...(trimmed ? [{ type: 'text', text: trimmed }] : []),
              ...attachments.map((a) => {
                if (a.type === 'image') return { type: 'image', mediaType: a.mediaType, data: a.data }
                if (a.type === 'file') return { type: 'file', name: a.name, language: a.language, data: a.data }
                return a
              }),
            ]
          : trimmed

      const userMessage = { id: uid(), role: 'user', content }
      const history = [
        ...conversation.messages
          .filter((m) => !m.error)
          .map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content },
      ]

      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                title: c.messages.length === 0 ? titleFrom([userMessage]) : c.title,
                updatedAt: Date.now(),
                messages: [...c.messages, userMessage],
              }
            : c
        )
      )
      setInput('')
      setAttachments([])

      if (!conversation.model) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: [
                    ...c.messages,
                    {
                      id: uid(),
                      role: 'assistant',
                      content: 'No model selected. Pick a provider and model below, or check your API key in Settings.',
                      error: true,
                    },
                  ],
                }
              : c
          )
        )
        return
      }
      runStream(convId, history, conversation.provider, conversation.model)
    },
    [activeId, conversations, isStreaming, runStream, attachments]
  )

  const stop = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setIsStreaming(false)
  }, [])

  const regenerate = useCallback(
    (assistantId) => {
      if (isStreaming) return
      const convId = activeId
      const conversation = conversations.find((c) => c.id === convId)
      if (!conversation) return

      const index = conversation.messages.findIndex((m) => m.id === assistantId)
      if (index < 0) return

      const history = conversation.messages
        .slice(0, index)
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content }))

      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId ? { ...c, messages: c.messages.slice(0, index) } : c
        )
      )

      if (history.length && conversation.model) {
        runStream(convId, history, conversation.provider, conversation.model)
      }
    },
    [activeId, conversations, isStreaming, runStream]
  )

  const editMessage = useCallback(
    (msgId, nextText) => {
      if (isStreaming) return
      const convId = activeId
      const conversation = conversations.find((c) => c.id === convId)
      if (!conversation) return

      const index = conversation.messages.findIndex((m) => m.id === msgId)
      if (index < 0) return

      // Keep everything up to and including the edited turn, then drop the
      // rest so the conversation branches from the new text.
      const kept = conversation.messages
        .slice(0, index + 1)
        .filter((m, i) => !m.error || i === index)
      const editedIndex = kept.length - 1
      kept[editedIndex] = { ...kept[editedIndex], content: nextText }

      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, updatedAt: Date.now(), messages: kept } : c))
      )

      const history = kept.map((m) => ({ role: m.role, content: m.content }))
      if (history.length && conversation.model) {
        runStream(convId, history, conversation.provider, conversation.model)
      }
    },
    [activeId, conversations, isStreaming, runStream]
  )

  const newChat = useCallback(() => {
    const fallback = providers.find((p) => p.id === 'orchestrator') || providers[0]
    if (!fallback) return
    const id = uid()
    const conversation = {
      id,
      title: 'New chat',
      messages: [],
      provider: fallback.id,
      providerLabel: fallback.label,
      model: modelsByProvider[fallback.id]?.[0]?.id || fallback.models?.[0]?.id || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setConversations((prev) => [conversation, ...prev])
    setActiveId(id)
    setSidebarOpen(false)
  }, [providers, modelsByProvider])

  const deleteConversation = useCallback(
    (id) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id)
        if (id === activeId) setActiveId(next[0]?.id || null)
        return next
      })
    },
    [activeId]
  )

  const renameConversation = useCallback((id, title) => updateConversation(id, { title }), [updateConversation])

  const handleProviderChange = useCallback(
    (providerId) => {
      const provider = providers.find((p) => p.id === providerId)
      loadModelsFor(providerId)
      const model =
        modelsByProvider[providerId]?.[0]?.id || provider?.models?.[0]?.id || ''
      if (activeId) updateConversation(activeId, { provider: providerId, providerLabel: provider?.label, model })
    },
    [providers, modelsByProvider, activeId, loadModelsFor, updateConversation]
  )

  const handleModelChange = useCallback(
    (modelId) => {
      if (activeId) updateConversation(activeId, { model: modelId })
    },
    [activeId, updateConversation]
  )

  const handleSaveSettings = useCallback((next) => {
    setSettings(next)
    saveSettings(next)
    if (next.localBaseUrl) {
      setModelsByProvider((m) => ({ ...m, local: [] }))
      loadModels('local')
    }
  }, [loadModels])

  const exportConversation = useCallback(() => {
    if (!active) return
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      conversation: {
        title: active.title,
        provider: active.provider,
        model: active.model,
        messages: active.messages.map((m) => ({
          role: m.role,
          content: contentToText(m.content),
          ...(m.model ? { model: m.model } : {}),
        })),
      },
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${active.title.replace(/[^a-z0-9]/gi, '-').slice(0, 40) || 'chat'}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [active])

  const importConversation = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (!data.conversation?.messages) return
        const id = uid()
        const provider = providers.find((p) => p.id === data.conversation.provider) || providers[0]
        const messages = data.conversation.messages.map((m) => ({
          id: uid(),
          role: m.role,
          content: m.content,
          ...(m.model ? { model: m.model } : {}),
        }))
        setConversations((prev) => [
          {
            id,
            title: data.conversation.title || 'Imported chat',
            messages,
            provider: provider?.id || 'openai',
            providerLabel: provider?.label || 'OpenAI',
            model: data.conversation.model || provider?.models?.[0]?.id || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ...prev,
        ])
        setActiveId(id)
      } catch (err) {
        console.warn('Failed to import:', err)
      }
    }
    input.click()
  }, [providers])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && settingsOpen) {
        setSettingsOpen(false)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        newChat()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault()
        exportConversation()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [settingsOpen, newChat, exportConversation])

  useEffect(() => {
    if (!active) return
    loadModelsFor(active.provider)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.provider])

  const models = useMemo(() => {
    if (!active) return []
    const provider = providers.find((p) => p.id === active.provider)
    return modelsByProvider[active.provider] || provider?.models || []
  }, [active, modelsByProvider, providers])

  const missingKey = useMemo(() => {
    const provider = providers.find((p) => p.id === active?.provider)
    if (!provider) return false
    return !provider.keyless && !provider.hasServerKey && !apiKeyFor(provider.id)
  }, [providers, active, apiKeyFor])

  const activeMeta = useMemo(() => {
    if (!active) return []
    return orchestratorMeta[active.id] || []
  }, [active, orchestratorMeta])

  const activeBackendLog = useMemo(() => (active ? backendLog[active.id] || [] : []), [active, backendLog])
  const activeRawLog = useMemo(() => (active ? rawLog[active.id] || [] : []), [active, rawLog])

  const showBackendPanel = orchestratorPanelOpen

  const showWelcome = !active || active.messages.length === 0

  return (
    <div className="app">
      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id)
          setSidebarOpen(false)
        }}
        onNew={newChat}
        onDelete={deleteConversation}
        onRename={renameConversation}
        onOpenSettings={() => setSettingsOpen(true)}
        onExport={exportConversation}
        onImport={importConversation}
        serverStatus={serverStatus}
      />
      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}

      <main className="app-main">
        <header className="topbar">
          <button
            className="icon-btn menu-toggle"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? <IconClose size={17} /> : <IconMenu />}
          </button>
          <span className="topbar-title">{active?.title || 'New chat'}</span>
          {active && (
            <button
              className={`icon-btn backend-toggle${orchestratorPanelOpen ? ' active' : ''}`}
              onClick={() => setOrchestratorPanelOpen((o) => !o)}
              title="Show backend activity"
              aria-label="Show backend activity"
            >
              <IconLayers />
            </button>
          )}
        </header>

        {serverStatus === 'down' && (
          <div className="banner">
            <span>
              Can&rsquo;t reach the API server on port 8787. Start it with{' '}
              <code>npm run dev</code>.
            </span>
          </div>
        )}

        {missingKey && (
          <div className="banner">
            <span>No API key configured for this provider yet.</span>
            <button className="btn ghost" onClick={() => setSettingsOpen(true)}>
              Open settings
            </button>
          </div>
        )}

        <div className="chat-scroll" ref={scrollRef}>
          {showWelcome ? (
            <div className="welcome">
              <h1>What are we working on?</h1>
              <p>
                {providers.length
                  ? `Connected via ${providers.find((p) => p.id === active?.provider)?.label || 'API'}. Paste screenshots, attach code files, or just type.`
                  : 'Connecting to the API server…'}
              </p>
              <div className="suggestion-grid">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.title}
                    className="suggestion"
                    onClick={() => send(s.prompt)}
                  >
                    <div className="suggestion-title">{s.title}</div>
                    <div className="suggestion-sub">{s.sub}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="chat-inner">
              {active.messages.map((m, i) => (
                <ChatMessage
                  key={m.id}
                  message={m}
                  isStreaming={isStreaming && i === active.messages.length - 1 && m.role === 'assistant'}
                  onRetry={regenerate}
                  onEdit={m.role === 'user' ? editMessage : undefined}
                  onRegenerate={regenerate}
                />
              ))}
            </div>
          )}
        </div>

        <Composer
          value={input}
          onChange={setInput}
          onSubmit={() => send(input)}
          onStop={stop}
          isStreaming={isStreaming}
          placeholder={
            active ? `Message ${providers.find((p) => p.id === active.provider)?.label || 'AI'}` : 'Message AI'
          }
          providers={providers}
          provider={active?.provider || ''}
          onProviderChange={handleProviderChange}
          models={models}
          model={active?.model || ''}
          onModelChange={handleModelChange}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          streamStatus={
            isStreaming && active
              ? { provider: active.provider, model: active.model, chunks: streamChunks }
              : null
          }
        />
      </main>

      {showBackendPanel && (
        <OrchestratorPanel
          events={activeMeta}
          log={activeBackendLog}
          rawEvents={activeRawLog}
          isStreaming={isStreaming}
          onClose={() => setOrchestratorPanelOpen(false)}
        />
      )}

      <Settings
        open={settingsOpen}
        settings={settings}
        providers={providers}
        onSave={handleSaveSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}