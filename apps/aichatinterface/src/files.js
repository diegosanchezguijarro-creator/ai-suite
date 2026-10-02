const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const CODE_EXTENSIONS = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  css: 'css',
  html: 'html',
  xml: 'xml',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  sh: 'bash',
  bash: 'bash',
  sql: 'sql',
  vue: 'html',
  svelte: 'html',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  lua: 'lua',
  r: 'r',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  clj: 'clojure',
  zig: 'zig',
  nim: 'nim',
  dart: 'dart',
  tf: 'hcl',
  dockerfile: 'dockerfile',
  env: 'bash',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  log: 'text',
  csv: 'text',
  svg: 'xml',
  txt: 'text',
}

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_FILES = 5
const IMAGE_MAX_DIM = 1024
const IMAGE_QUALITY = 0.82
const IMAGE_SIZE_THRESHOLD = 800 * 1024

function extFromName(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function isImageFile(file) {
  return IMAGE_TYPES.has(file.type) || (!file.type && /\.(png|jpe?g|gif|webp)$/i.test(file.name))
}

function isCodeFile(file) {
  const ext = extFromName(file.name)
  return ext in CODE_EXTENSIONS
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.readAsText(file)
  })
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

export async function resizeImage(dataUrl) {
  try {
    const img = await loadImage(dataUrl)
    if (img.width <= IMAGE_MAX_DIM && img.height <= IMAGE_MAX_DIM && dataUrl.length < IMAGE_SIZE_THRESHOLD * 1.37) {
      return dataUrl
    }

    let { width, height } = img
    if (width > IMAGE_MAX_DIM || height > IMAGE_MAX_DIM) {
      const scale = IMAGE_MAX_DIM / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, width, height)

    return canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
  } catch {
    return dataUrl
  }
}

function dataUrlToParts(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return { mediaType: 'image/png', data: dataUrl }
  return { mediaType: match[1], data: match[2] }
}

export async function processFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`${file.name} exceeds the 10 MB limit`)
  }

  if (isImageFile(file)) {
    const dataUrl = await readAsDataURL(file)
    const resized = await resizeImage(dataUrl)
    const { mediaType, data } = dataUrlToParts(resized)
    return { type: 'image', name: file.name, mediaType, data }
  }

  if (isCodeFile(file)) {
    const text = await readAsText(file)
    const ext = extFromName(file.name)
    return { type: 'file', name: file.name, language: CODE_EXTENSIONS[ext] || 'text', data: text }
  }

  throw new Error(`Unsupported file type: ${file.name}`)
}

export async function processFiles(fileList) {
  const files = Array.from(fileList).slice(0, MAX_FILES)
  const results = []
  for (const file of files) {
    try {
      results.push(await processFile(file))
    } catch (e) {
      results.push({ type: 'error', name: file.name, error: e.message })
    }
  }
  return results
}

export function isSupportedFile(file) {
  return isImageFile(file) || isCodeFile(file)
}

export function attachmentPreviewUrl(block) {
  if (block.type === 'image') return `data:${block.mediaType};base64,${block.data}`
  return null
}

export function contentHasImages(content) {
  if (!Array.isArray(content)) return false
  return content.some((b) => b.type === 'image')
}

export function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
}
