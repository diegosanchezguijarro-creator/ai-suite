import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function findDocsDir() {
  const candidates = [
    path.join(projectRoot, 'docs'),
    path.join(process.resourcesPath || '', 'docs'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'docs'),
  ]
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, 'index.md'))) return dir
  }
  return null
}

export function listDocs() {
  const dir = findDocsDir()
  if (!dir) return { dir: null, files: [] }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({
      slug: f.replace(/\.md$/, ''),
      title: friendlyTitle(f.replace(/\.md$/, '')),
      file: path.join(dir, f),
    }))
  files.sort((a, b) =>
    a.slug === 'index' ? -1 : b.slug === 'index' ? 1 : a.slug.localeCompare(b.slug)
  )
  return { dir, files }
}

function friendlyTitle(slug) {
  const titles = {
    index: 'Overview',
    install: 'Installation',
    usage: 'Usage',
    env: 'Environment / API Keys',
    architecture: 'Architecture',
    troubleshooting: 'Troubleshooting',
  }
  return titles[slug] || slug.charAt(0).toUpperCase() + slug.slice(1)
}

export function renderDoc(slug) {
  const dir = findDocsDir()
  if (!dir) return { ok: false, error: 'Docs folder not found' }
  const safe = String(slug || '').replace(/[^a-z0-9-]/gi, '')
  const file = path.join(dir, `${safe}.md`)
  if (!fs.existsSync(file)) return { ok: false, error: `Doc not found: ${safe}` }
  const html = marked.parse(fs.readFileSync(file, 'utf8'))
  // Wrap raw HTML in a template with a doc stylesheet so it renders nicely.
  return { ok: true, slug: safe, title: friendlyTitle(safe), html, wrapHtml: wrap(html, friendlyTitle(safe)) }
}

function wrap(body, title) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} · AI Suite docs</title><style>
    body { background:#0e1013; color:#e8eaf0; font-family:'Segoe UI',system-ui,sans-serif; max-width:760px; margin:0 auto; padding:32px 20px; line-height:1.65; }
    h1,h2,h3 { color:#fff; margin-top:1.6em; }
    code { background:#1d2129; padding:2px 6px; border-radius:5px; font-size:0.9em; }
    pre { background:#16191f; border:1px solid #2a2f3a; padding:12px; border-radius:10px; overflow-x:auto; }
    pre code { background:transparent; padding:0; }
    a { color:#5b8cff; }
    table { border-collapse:collapse; width:100%; margin:14px 0; }
    th,td { border:1px solid #2a2f3a; padding:7px 10px; text-align:left; font-size:14px; }
    th { background:#1d2129; }
    blockquote { border-left:3px solid #5b8cff; margin:10px 0; padding:4px 14px; color:#8b93a7; }
    hr { border:none; border-top:1px solid #2a2f3a; margin:26px 0; }
    .doc-title { color:#8b93a7; font-size:13px; letter-spacing:0.06em; text-transform:uppercase; }
  </style></head><body>${body}</body></html>`
}
