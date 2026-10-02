import { useState } from 'react'
import { IconClose, IconSun, IconMoon } from './Icons.jsx'

export function Settings({ open, settings, providers, onSave, onClose }) {
  const [draft, setDraft] = useState(settings)
  const [revealed, setRevealed] = useState({})

  if (!open) return null

  const close = () => {
    setDraft(settings)
    onClose()
  }

  const save = () => {
    onSave(draft)
    onClose()
  }

  const setKey = (id, value) =>
    setDraft((d) => ({ ...d, apiKeys: { ...d.apiKeys, [id]: value } }))

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={close} aria-label="Close settings">
            <IconClose />
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-intro">
            Keys entered here override the server&rsquo;s <code>.env</code> file. They live
            only in this tab&rsquo;s session storage — never written to disk, never included
            in exports, and cleared when you close the tab. For a permanent key, set it
            in <code>.env</code> on the server.
          </p>

          {providers.map((p) => (
            <div className="field" key={p.id}>
              <label htmlFor={`key-${p.id}`}>
                {p.label} API key
                {p.hasServerKey && !draft.apiKeys?.[p.id] && (
                  <span className="field-flag ok">set on server</span>
                )}
              </label>
              <div className="field-row">
                <input
                  id={`key-${p.id}`}
                  type={revealed[p.id] ? 'text' : 'password'}
                  value={draft.apiKeys?.[p.id] || ''}
                  placeholder={p.keyless ? 'optional for most local servers' : 'sk-…'}
                  onChange={(e) => setKey(p.id, e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  className="btn ghost"
                  onClick={() => setRevealed((r) => ({ ...r, [p.id]: !r[p.id] }))}
                >
                  {revealed[p.id] ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="field-hint">
                {p.keyless
                  ? `Base URL ${p.baseUrl} · any OpenAI-compatible endpoint works here.`
                  : `Base URL ${p.baseUrl}`}
              </p>
            </div>
          ))}

          <div className="field">
            <label htmlFor="local-base">
              Local base URL override
            </label>
            <input
              id="local-base"
              type="url"
              value={draft.localBaseUrl || ''}
              placeholder="http://localhost:11434/v1"
              onChange={(e) => setDraft((d) => ({ ...d, localBaseUrl: e.target.value }))}
              spellCheck={false}
            />
            <p className="field-hint">
              Points the Local provider at Ollama, LM Studio, vLLM, llama.cpp or any other
              OpenAI-compatible server.
            </p>
          </div>

          <div className="theme-row">
            <span>Extended thinking</span>
            <button
              className={`toggle${draft.thinking ? ' on' : ''}`}
              onClick={() => setDraft((d) => ({ ...d, thinking: !d.thinking }))}
              role="switch"
              aria-checked={Boolean(draft.thinking)}
              aria-label="Toggle extended thinking"
            >
              <span className="sr-only">Toggle extended thinking</span>
            </button>
          </div>
          {draft.thinking && (
            <p className="field-hint">
              Asks thinking models (e.g. Claude with a reasoning budget, GLM/DeepSeek-style
              models) to reason before answering. Their thought process appears above the
              answer. Off = request unchanged, but thinking deltas are still shown if the
              model sends them.
            </p>
          )}

          <div className="theme-row">
            <span>Dark theme</span>
            <button
              className={`toggle${draft.theme === 'dark' ? ' on' : ''}`}
              onClick={() =>
                setDraft((d) => ({ ...d, theme: d.theme === 'dark' ? 'light' : 'dark' }))
              }
              role="switch"
              aria-checked={draft.theme === 'dark'}
              aria-label="Toggle dark theme"
            >
              <span className="sr-only">Toggle dark theme</span>
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}