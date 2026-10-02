import { useMemo, useState } from 'react'
import {
  IconNew,
  IconSearch,
  IconTrash,
  IconPencil,
  IconGear,
  IconLogo,
  IconDownload,
  IconFile,
} from './Icons.jsx'

function groupByDate(convs) {
  const now = Date.now()
  const day = 86400000
  const buckets = { Today: [], 'Yesterday': [], 'Previous 7 days': [], Older: [] }

  for (const c of convs) {
    const age = now - new Date(c.updatedAt).getTime()
    if (age < day) buckets.Today.push(c)
    else if (age < 2 * day) buckets.Yesterday.push(c)
    else if (age < 7 * day) buckets['Previous 7 days'].push(c)
    else buckets.Older.push(c)
  }
  return buckets
}

export function Sidebar({
  open,
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onOpenSettings,
  onExport,
  onImport,
  serverStatus,
}) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => c.title.toLowerCase().includes(q))
  }, [conversations, query])

  const groups = useMemo(() => groupByDate(filtered), [filtered])

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <IconLogo />
          <span>AI Chat</span>
        </div>
        <button className="new-chat-btn" onClick={onNew}>
          <IconNew />
          <span>New chat</span>
        </button>
        <div className="sidebar-search">
          <IconSearch />
          <input
            type="text"
            value={query}
            placeholder="Search chats"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search conversations"
          />
        </div>
      </div>

      <nav className="conv-list">
        {conversations.length === 0 && (
          <p className="sidebar-empty">No conversations yet.</p>
        )}
        {Object.entries(groups).map(([label, items]) =>
          items.length ? (
            <div key={label}>
              <div className="conv-section-label">{label}</div>
              {items.map((c) => (
                <div
                  key={c.id}
                  className={`conv-item${c.id === activeId ? ' active' : ''}`}
                >
                  <button
                    className="conv-item-btn"
                    onClick={() => onSelect(c.id)}
                    title={c.title}
                  >
                    <span className="conv-item-title">{c.title}</span>
                    <span className="conv-item-sub">{c.providerLabel || c.provider}</span>
                  </button>
                  <div className="conv-item-actions">
                    <button
                      className="icon-btn"
                      title="Rename"
                      aria-label="Rename conversation"
                      onClick={() => {
                        const next = window.prompt('Rename conversation', c.title)
                        if (next && next.trim()) onRename(c.id, next.trim())
                      }}
                    >
                      <IconPencil size={14} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Delete"
                      aria-label="Delete conversation"
                      onClick={() => {
                        if (window.confirm('Delete this conversation?')) onDelete(c.id)
                      }}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-footer-actions">
          <button className="sidebar-footer-btn" onClick={onExport} title="Export chat" aria-label="Export conversation">
            <IconDownload size={15} />
          </button>
          <button className="sidebar-footer-btn" onClick={onImport} title="Import chat" aria-label="Import conversation">
            <IconFile size={15} />
          </button>
        </div>
        <button className="sidebar-footer-btn" onClick={onOpenSettings}>
          <IconGear />
          <span>Settings</span>
          <span
            className={`status-dot${serverStatus === 'ok' ? ' ok' : ''}`}
            style={{ marginLeft: 'auto' }}
            title={`API server: ${serverStatus}`}
          />
        </button>
      </div>
    </aside>
  )
}