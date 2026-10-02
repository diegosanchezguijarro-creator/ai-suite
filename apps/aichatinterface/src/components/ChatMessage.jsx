import { useCallback, useEffect, useState } from 'react'
import { Markdown } from './Markdown.jsx'
import { CodeBlock } from './CodeBlock.jsx'
import { IconCopy, IconCheck, IconRetry, IconPencil, IconUser, IconLogo, IconChevron } from './Icons.jsx'
import { contentToText } from '../files.js'

// Orchestrator pipeline telemetry is verbose (prompts, worker output); keep
// only the headline fields so the layers view stays a few lines long.
function layerDetail(meta) {
  const parts = []
  const push = (text) => {
    if (text) parts.push(String(text).length > 160 ? `${String(text).slice(0, 160)}…` : String(text))
  }
  push(meta.route && `route ${meta.route}${meta.source ? ` (${meta.source})` : ''}`)
  push(meta.escalated && `escalated to parallel-analysis (confidence below floor)`)
  if (meta.model) push(`model ${meta.model}`)
  else if (meta.provider) push(`provider ${meta.provider}`)
  if (meta.layer === 'gateway' && meta.messageCount != null) push(`${meta.messageCount} messages`)
  if (meta.layer === 'workers' && meta.taskCount != null) push(`${meta.taskCount} sub-tasks`)
  if (meta.taskId) push(meta.taskId)
  if (meta.confidence != null) push(`confidence ${Number(meta.confidence).toFixed(2)}`)
  if (meta.probabilities) {
    const top = Object.entries(meta.probabilities).sort((a, b) => b[1] - a[1])[0]
    if (top) push(`p[${top[0]}] ${Number(top[1]).toFixed(2)}`)
  }
  if (meta.noul != null) push(`noul ${Number(meta.noul).toFixed(2)}`)
  if (meta.score != null) push(`score ${Number(meta.score).toFixed(1)}/10`)
  if (meta.attempts) push(`rewrite attempts ${meta.attempts}`)
  push(meta.reason && `reason: ${meta.reason}`)
  if (meta.status === 'error') push(meta.message)
  return parts.join(' · ') || (meta.status === 'running' ? 'running…' : meta.status)
}

const TONE_BY_STATUS = {
  done: 'done',
  skipped: 'done',
  running: 'running',
  active: 'running',
  streaming: 'running',
  rewrite: 'running',
  error: 'error',
}

function layerTone(status) {
  return TONE_BY_STATUS[status] || 'muted'
}

function ThinkingBlock({ text, layers, streaming }) {
  const [open, setOpen] = useState(Boolean(streaming && (text || layers?.length)))
  useEffect(() => {
    if (streaming) setOpen(true)
  }, [streaming])

  const hasLayers = Boolean(layers?.length)

  return (
    <div className={`thinking${open ? ' open' : ''}`}>
      <button
        className="thinking-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? 'Collapse thinking' : 'Expand thinking'}
      >
        <IconChevron size={12} />
        <span>
          {streaming && !text && !hasLayers
            ? 'Thinking…'
            : `${hasLayers ? 'Orchestrator layers' : 'Thought process'}${text && hasLayers ? ' + reasoning' : ''}`}
        </span>
      </button>
      {open && (text || hasLayers) && (
        <div className="thinking-body">
          {hasLayers && (
            <ul className="thinking-layers">
              {layers.map((meta, i) => (
                <li key={i} className={`thinking-layer ${layerTone(meta.status)}`}>
                  <span className="thinking-layer-name">{meta.layer || 'orchestrator'}</span>
                  <span className="thinking-layer-status">{meta.status}</span>
                  <span className="thinking-layer-detail">{layerDetail(meta)}</span>
                </li>
              ))}
            </ul>
          )}
          {text}
        </div>
      )}
    </div>
  )
}

function ContentBlocks({ blocks }) {
  const [lightbox, setLightbox] = useState(null)

  if (!Array.isArray(blocks)) return <Markdown>{blocks}</Markdown>

  return (
    <>
      <div className="msg-blocks">
        {blocks.map((block, i) => {
          if (block.type === 'text') {
            return <Markdown key={i}>{block.text}</Markdown>
          }
          if (block.type === 'image') {
            const src = `data:${block.mediaType};base64,${block.data}`
            return (
              <div key={i} className="msg-image-wrap">
                <button className="msg-image-btn" onClick={() => setLightbox(src)} aria-label="Expand image">
                  <img src={src} alt={block.name || 'Attached image'} className="msg-image" />
                </button>
              </div>
            )
          }
          if (block.type === 'file') {
            return (
              <div key={i} className="msg-file">
                <CodeBlock language={block.language || 'text'} code={block.data} />
              </div>
            )
          }
          return null
        })}
      </div>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Image preview">
          <img src={lightbox} alt="Full size" className="lightbox-img" />
        </div>
      )}
    </>
  )
}

export function ChatMessage({ message, isStreaming, onRetry, onEdit, onRegenerate }) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const isUser = message.role === 'user'
  const hasContent = Boolean(
    typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content) && message.content.length > 0
  )

  const textContent = contentToText(message.content)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(textContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }, [textContent])

  const startEdit = useCallback(() => {
    setDraft(textContent)
    setEditing(true)
  }, [textContent])

  const saveEdit = useCallback(() => {
    const next = draft.trim()
    setEditing(false)
    if (next && next !== textContent) onEdit(message.id, next)
  }, [draft, textContent, message.id, onEdit])

  const label = isUser ? 'You' : 'Assistant'
  const hasImages = Array.isArray(message.content) && message.content.some((b) => b.type === 'image')
  const hasFiles = Array.isArray(message.content) && message.content.some((b) => b.type === 'file')

  return (
    <div className="msg">
      <div className={`msg-avatar ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? <IconUser /> : <IconLogo size={15} />}
      </div>

      <div className="msg-body">
        <div className="msg-name">{label}</div>

        {isUser ? (
          editing ? (
            <>
              <textarea
                className="edit-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(12, draft.split('\n').length + 1)}
                autoFocus
              />
              <div className="edit-actions">
                <button className="btn ghost" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button className="btn primary" onClick={saveEdit}>
                  Send
                </button>
              </div>
            </>
          ) : (
            <>
              {(hasImages || hasFiles) && <ContentBlocks blocks={message.content} />}
              {!hasImages && !hasFiles && (
                <div className="msg-user-bubble">{textContent}</div>
              )}
              {(hasImages || hasFiles) && textContent && (
                <div className="msg-user-bubble msg-user-text">{textContent}</div>
              )}
            </>
          )
        ) : message.error ? (
          <div className="msg-error">
            {message.content}
            {onRetry && (
              <button className="btn ghost" onClick={() => onRetry(message.id)} style={{ marginLeft: 10 }}>
                Retry
              </button>
            )}
          </div>
        ) : (
          <div className="msg-content">
            {(message.thinking || message.layers?.length) && (
              <ThinkingBlock
                text={message.thinking}
                layers={message.layers}
                streaming={Boolean(isStreaming && !message.content)}
              />
            )}
            <ContentBlocks blocks={message.content} />
            {isStreaming && <span className="caret">▍</span>}
          </div>
        )}

        {!isStreaming && !editing && (hasContent || message.thinking || message.error) && (
          <div className="msg-actions">
            {hasContent && (
              <button className="icon-btn" onClick={copy} title="Copy" aria-label="Copy message">
                {copied ? <IconCheck /> : <IconCopy />}
              </button>
            )}
            {isUser && onEdit && (
              <button className="icon-btn" onClick={startEdit} title="Edit" aria-label="Edit message">
                <IconPencil />
              </button>
            )}
            {!isUser && onRegenerate && (
              <button
                className="icon-btn"
                onClick={() => onRegenerate(message.id)}
                title="Regenerate"
                aria-label="Regenerate response"
              >
                <IconRetry />
              </button>
            )}
          </div>
        )}

        {!isUser && !isStreaming && message.model && !message.error && (
          <div className="msg-meta">
            {message.model}
            {(message.inputTokens || message.outputTokens) && (
              <span>
                {' '}
                · {message.inputTokens ?? '–'} in / {message.outputTokens ?? '–'} out
              </span>
            )}
            {message.diagnostics && (
              <span>
                {' '}
                ·{' '}
                {[
                  message.diagnostics.ttfbMs != null && `TTFB ${message.diagnostics.ttfbMs}ms`,
                  `${message.diagnostics.chunkCount ?? '–'} chunks`,
                  message.diagnostics.totalMs != null && `${message.diagnostics.totalMs}ms total`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
