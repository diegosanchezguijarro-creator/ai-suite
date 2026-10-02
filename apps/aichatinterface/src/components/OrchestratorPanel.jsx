import { useState } from 'react'
import { IconClose, IconChevron } from './Icons.jsx'

function classForStatus(status) {
  if (status === 'error') return 'status-error'
  if (status === 'running') return 'status-running'
  if (status === 'skipped') return 'status-skipped'
  return 'status-done'
}

function formatLayerName(layer) {
  return layer ? layer.charAt(0).toUpperCase() + layer.slice(1) : 'Unknown'
}

function timeOf(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour12: false })
}

function PromptBlock({ title, prompt }) {
  const [open, setOpen] = useState(false)
  if (!prompt) return null
  const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt, null, 2)
  return (
    <div className="orch-prompt">
      <button className="orch-prompt-title" onClick={() => setOpen((o) => !o)}>
        <IconChevron size={12} className={open ? 'open' : ''} />
        {title}
      </button>
      {open && (
        <pre className="orch-prompt-body">
          <code>{text}</code>
        </pre>
      )}
    </div>
  )
}

function EventCard({ event }) {
  const { layer, status } = event
  const [open, setOpen] = useState(status === 'error' || status === 'skipped')

  return (
    <div className={`orch-event ${classForStatus(status)}`}>
      <button className="orch-event-header" onClick={() => setOpen((o) => !o)}>
        <span className="orch-event-dot" />
        <span className="orch-event-layer">{formatLayerName(layer)}</span>
        <span className="orch-event-status">{status}</span>
        <IconChevron size={12} className={open ? 'open' : ''} />
      </button>
      {open && (
        <div className="orch-event-body">
          {event.model && (
            <div className="orch-row">
              <span>Model</span>
              <code>{event.model}</code>
            </div>
          )}
          {event.route && (
            <div className="orch-row">
              <span>Route</span>
              <code>{event.route}</code>
            </div>
          )}
          {event.source && (
            <div className="orch-row">
              <span>Source</span>
              <code>{event.source}</code>
            </div>
          )}
          {typeof event.messageCount === 'number' && (
            <div className="orch-row">
              <span>Messages</span>
              <span>{event.messageCount}</span>
            </div>
          )}
          {typeof event.prunedMessageCount === 'number' && (
            <div className="orch-row">
              <span>Pruned context</span>
              <span>
                {event.prunedMessageCount} / {event.originalMessageCount}
              </span>
            </div>
          )}
          {event.subTasks && (
            <div className="orch-subtasks">
              <div className="orch-section-title">Sub-tasks</div>
              <ol>
                {event.subTasks.map((t) => (
                  <li key={t.id}>{t.task}</li>
                ))}
              </ol>
            </div>
          )}
          {typeof event.noul === 'number' && (
            <div className="orch-row">
              <span>NOUL</span>
              <span>{event.noul.toFixed(2)}</span>
            </div>
          )}
          {typeof event.score === 'number' && (
            <div className="orch-row">
              <span>Quality score</span>
              <span>{event.score.toFixed(2)}</span>
            </div>
          )}
          {typeof event.attempts === 'number' && event.attempts > 0 && (
            <div className="orch-row">
              <span>Rewrite attempts</span>
              <span>{event.attempts}</span>
            </div>
          )}
          {event.reason && (
            <div className="orch-row">
              <span>Reason</span>
              <span>{event.reason}</span>
            </div>
          )}
          {event.message && (
            <div className="orch-error-message">
              <strong>Error:</strong> {event.message}
            </div>
          )}
          {event.systemPrompt && <PromptBlock title="System prompt" prompt={event.systemPrompt} />}
          {event.prompt && <PromptBlock title="Prompt" prompt={event.prompt} />}
          {event.results && (
            <div className="orch-results">
              <div className="orch-section-title">Worker outputs</div>
              {event.results.map((r, i) => (
                <PromptBlock key={r.taskId || i} title={`Worker ${r.taskId || i + 1}`} prompt={r.text} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const KIND_LABEL = {
  start: 'Request started',
  request: 'Endpoint resolved',
  done: 'Stream finished',
  layer: 'Pipeline layer',
  error: 'Error',
}

function LogRow({ entry }) {
  const tone = entry.kind === 'error' ? 'status-error' : entry.kind === 'done' ? 'status-done' : 'status-running'
  return (
    <div className={`orch-log-row ${tone}`}>
      <span className="orch-log-time">{timeOf(entry.time)}</span>
      <span className="orch-log-kind">{KIND_LABEL[entry.kind] || entry.kind}</span>
      <span className="orch-log-detail">
        {entry.provider && <code>{entry.provider}</code>} {entry.model && <code>{entry.model}</code>}
        {entry.baseUrl && <span className="orch-log-url">{entry.baseUrl}</span>}
        {entry.layer && <code>{entry.layer}</code>}
        {entry.status && <span>· {entry.status}</span>}
        {entry.detail && <span>· {entry.detail}</span>}
      </span>
    </div>
  )
}

function RawEventRow({ event }) {
  return (
    <pre className="orch-raw-row">
      <code>
        {`+${event.t % 100000}`} {JSON.stringify(event)}
      </code>
    </pre>
  )
}

export function OrchestratorPanel({ events, log = [], rawEvents = [], isStreaming, onClose }) {
  const [tab, setTab] = useState('layers')
  const errorCount = events.filter((e) => e.status === 'error').length
  const errorCountTotal = errorCount + log.filter((e) => e.kind === 'error').length

  return (
    <aside className="orch-panel">
      <div className="orch-panel-header">
        <div>
          <h2>Backend activity</h2>
          <p>
            {events.length} layer events · {log.length} log entries ·{' '}
            {errorCountTotal} error{errorCountTotal === 1 ? '' : 's'}
            {isStreaming ? ' · streaming…' : ''}
          </p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close backend panel">
          <IconClose />
        </button>
      </div>
      <div className="orch-tabs">
        <button className={`orch-tab${tab === 'log' ? ' active' : ''}`} onClick={() => setTab('log')}>
          Timeline
        </button>
        <button className={`orch-tab${tab === 'layers' ? ' active' : ''}`} onClick={() => setTab('layers')}>
          Orchestrator layers
        </button>
        <button className={`orch-tab${tab === 'raw' ? ' active' : ''}`} onClick={() => setTab('raw')}>
          Raw SSE
        </button>
      </div>
      <div className="orch-panel-body">
        {tab === 'log' ? (
          log.length === 0 ? (
            <div className="orch-empty">Send a message to see backend activity.</div>
          ) : (
            <div className="orch-log">
              {log.map((entry, i) => (
                <LogRow key={i} entry={entry} />
              ))}
            </div>
          )
        ) : tab === 'raw' ? (
          rawEvents.length === 0 ? (
            <div className="orch-empty">No raw events captured yet.</div>
          ) : (
            <div className="orch-raw">
              {rawEvents.map((event, i) => (
                <RawEventRow key={i} event={event} />
              ))}
            </div>
          )
        ) : events.length === 0 ? (
          <div className="orch-empty">
            No orchestrator layer events — this response streamed directly, or the active
            provider is not the orchestrator.
          </div>
        ) : (
          <div className="orch-timeline">
            {events.map((event, i) => (
              <EventCard key={i} event={event} />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
