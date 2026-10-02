import { useCallback, useEffect, useRef, useState } from 'react'
import { IconSend, IconStop, IconChevron, IconPaperclip, IconImage, IconFile, IconClose } from './Icons.jsx'
import { processFiles, attachmentPreviewUrl, isSupportedFile } from '../files.js'

const MAX_HEIGHT = 240

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  placeholder,
  providers,
  provider,
  onProviderChange,
  models,
  model,
  onModelChange,
  attachments,
  onAttachmentsChange,
  streamStatus,
}) {
  const ref = useRef(null)
  const fileRef = useRef(null)
  const [focused, setFocused] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  const addFiles = useCallback(
    async (fileList) => {
      if (!fileList?.length) return
      setProcessing(true)
      try {
        const results = await processFiles(fileList)
        const valid = results.filter((r) => r.type !== 'error')
        const errors = results.filter((r) => r.type === 'error')
        if (errors.length) {
          for (const e of errors) console.warn(e.error)
        }
        if (valid.length) onAttachmentsChange([...attachments, ...valid])
      } finally {
        setProcessing(false)
      }
    },
    [attachments, onAttachmentsChange]
  )

  const removeAttachment = useCallback(
    (index) => {
      onAttachmentsChange(attachments.filter((_, i) => i !== index))
    },
    [attachments, onAttachmentsChange]
  )

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!isStreaming && (value.trim() || attachments.length)) onSubmit()
    }
  }

  const handlePaste = useCallback(
    (e) => {
      const items = e.clipboardData?.items
      if (!items) return
      const files = []
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file && isSupportedFile(file)) files.push(file)
        }
      }
      if (files.length) {
        e.preventDefault()
        addFiles(files)
      }
    },
    [addFiles]
  )

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      setDragging(false)
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
    },
    [addFiles]
  )

  const handleFileSelect = useCallback(
    (e) => {
      if (e.target.files?.length) addFiles(e.target.files)
      e.target.value = ''
    },
    [addFiles]
  )

  const canSend = (Boolean(value.trim()) || attachments.length > 0) && !isStreaming
  const modelOptions = models.length ? models : model ? [{ id: model, label: model }] : []

  return (
    <div
      className={`composer-wrap${dragging ? ' composer-drag' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="composer-inner">
        {attachments.length > 0 && (
          <div className="attachment-strip">
            {attachments.map((a, i) => (
              <div key={i} className="attachment-chip">
                {a.type === 'image' ? (
                  <div className="attachment-thumb">
                    <img src={attachmentPreviewUrl(a)} alt={a.name} />
                  </div>
                ) : (
                  <div className="attachment-file">
                    <IconFile size={13} />
                    <span>{a.name}</span>
                  </div>
                )}
                <button
                  className="attachment-remove"
                  onClick={() => removeAttachment(i)}
                  aria-label={`Remove ${a.name}`}
                >
                  <IconClose size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="composer">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,.js,.ts,.jsx,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.css,.html,.xml,.json,.yaml,.yml,.toml,.md,.txt,.sh,.bash,.sql,.vue,.svelte,.php,.swift,.kt,.scala,.lua,.r,.ex,.exs,.erl,.hs,.clj,.zig,.nim,.dart,.tf,.env,.ini,.cfg,.conf,.log,.csv,.svg"
            onChange={handleFileSelect}
            className="sr-only"
            tabIndex={-1}
          />
          <button
            className="icon-btn attach-btn"
            onClick={() => fileRef.current?.click()}
            title="Attach files"
            aria-label="Attach files"
            disabled={processing}
          >
            {processing ? <span className="spinner" /> : <IconPaperclip size={17} />}
          </button>
          <textarea
            ref={ref}
            rows={1}
            value={value}
            placeholder={
              dragging
                ? 'Drop files here…'
                : focused
                  ? 'Send a message…'
                  : placeholder || 'Message AI'
            }
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-label="Message"
          />
          {isStreaming ? (
            <button
              className="send-btn"
              onClick={onStop}
              title="Stop generating"
              aria-label="Stop generating"
            >
              <IconStop />
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={onSubmit}
              disabled={!canSend}
              title="Send message"
              aria-label="Send message"
            >
              <IconSend />
            </button>
          )}
        </div>

        <div className="composer-meta">
          <div className="model-picker">
            <select
              value={provider}
              onChange={(e) => onProviderChange(e.target.value)}
              aria-label="Provider"
              title="Provider"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <IconChevron size={12} />
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              aria-label="Model"
              title="Model"
            >
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || m.id}
                </option>
              ))}
            </select>
          </div>
          <span>
            {streamStatus
              ? `Streaming ${streamStatus.model || ''} from ${streamStatus.provider || ''} — ${streamStatus.chunks} chunks received…`
              : 'Enter to send · Shift+Enter for newline · Paste or drop files'}
          </span>
        </div>
      </div>
    </div>
  )
}
