import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import 'katex/dist/katex.min.css'
import { CodeBlock } from './CodeBlock.jsx'

/**
 * react-markdown hands us the code node; we swap in our own chrome so every
 * fenced block gets a language label and a copy button. rehype-highlight has
 * already added hljs classes to the children at this point.
 */
const components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '')
    const raw = String(children ?? '')

    if (match) {
      const text = raw.replace(/\n$/, '')
      return <CodeBlock language={match[1]} code={text} />
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  },
  pre({ children }) {
    return children
  },
}

export const Markdown = memo(function Markdown({ children }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})