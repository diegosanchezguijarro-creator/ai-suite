import { useState } from 'react'
import { IconCopy, IconCheck } from './Icons.jsx'

export function CodeBlock({ language, code }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{language || 'text'}</span>
        <button className="icon-btn" onClick={copy} title="Copy code" aria-label="Copy code">
          {copied ? <IconCheck /> : <IconCopy />}
        </button>
      </div>
      <pre>
        <code className={`hljs language-${(language || '').toLowerCase()}`}>{code}</code>
      </pre>
    </div>
  )
}