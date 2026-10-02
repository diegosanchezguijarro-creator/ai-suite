// Generates build/icon.png (512x512) and build/icon.ico from a tiny
// uncompressed RGBA buffer without external deps.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'build')
fs.mkdirSync(outDir, { recursive: true })

const W = 512
const H = 512
const px = Buffer.alloc(W * H * 4)

// Rounded-rect gradient background + "A>" glyph approximation
function set(x, y, r, g, b) {
  const i = (y * W + x) * 4
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255
}
function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const dx = Math.max(x0 + r - x, x - (x1 - r), 0)
  const dy = Math.max(y0 + r - y, y - (y1 - r), 0)
  return dx * dx + dy * dy <= r * r
}
function insideGlyph(x, y) {
  // Draw "AI" letters as simple thick strokes
  // "A" triangle: apex (256,150), feet (166,360)/(346,360), stroke width 26
  // Crossbar at y=270 between x=196..316
  const stroke = 24
  const apex = { x: 256, y: 150 }
  const left = { x: 166, y: 360 }
  const right = { x: 346, y: 360 }

  const distToSeg = (p, a, b) => {
    const vx = b.x - a.x, vy = b.y - a.y
    const wx = p.x - a.x, wy = p.y - a.y
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
    const cx = a.x + t * vx, cy = a.y + t * vy
    return Math.hypot(p.x - cx, p.y - cy)
  }

  if (distToSeg({ x, y }, apex, left) <= stroke / 2) return true
  if (distToSeg({ x, y }, apex, right) <= stroke / 2) return true
  // crossbar
  if (y >= 262 && y <= 286 && x >= 200 && x <= 312) return true
  // "I" stem: x 380..404, y 150..360
  if (x >= 380 && x <= 404 && y >= 150 && y <= 360) return true
  // "I" serif top/bottom
  if (y >= 134 && y <= 158 && x >= 356 && x <= 428) return true
  if (y >= 352 && y <= 376 && x >= 356 && x <= 428) return true
  return false
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (insideRoundRect(x, y, 32, 32, 479, 479, 74)) {
      // diagonal gradient indigo → cyan
      const t = (x + y) / (W + H)
      const r = Math.round(40 + 30 * t)
      const g = Math.round(44 + 90 * t)
      const b = Math.round(96 + 140 * t)
      if (insideGlyph(x, y)) set(x, y, 236, 240, 252)
      else set(x, y, r, g, b)
    } else {
      // fully transparent outside the rounded rect
      const i = (y * W + x) * 4
      px[i + 3] = 0
    }
  }
}

// PNG encoder
function crc32(buf) {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let c = 0xffffffff
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8; ihdr[9] = 6 // bit depth 8, color type RGBA
const stride = W * 4 + 1
const raw = Buffer.alloc(stride * H)
for (let y = 0; y < H; y++) {
  raw[y * stride] = 0 // filter none
  px.copy(raw, y * stride + 1, y * W * 4, (y + 1) * W * 4)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
fs.writeFileSync(path.join(outDir, 'icon.png'), png)
console.log(`[icon] wrote ${path.join(outDir, 'icon.png')} (${png.length} bytes)`)

// ICO wrapper: embeds a BMP-style representation of the 512x512 RGBA
const bmpHeader = Buffer.alloc(40)
bmpHeader.writeUInt32LE(40, 0)                 // header size
bmpHeader.writeInt32LE(W, 4)
bmpHeader.writeInt32LE(H * 2, 8)               // XOR+AND
bmpHeader.writeUInt16LE(1, 12)                 // planes
bmpHeader.writeUInt16LE(32, 14)                // bpp
const xorSize = W * H * 4
const xor = Buffer.alloc(xorSize)
// BMP stores bottom-up and BGRA
for (let y = 0; y < H; y++) {
  const srcRow = H - 1 - y
  for (let x = 0; x < W; x++) {
    const si = (srcRow * W + x) * 4
    const di = (y * W + x) * 4
    xor[di] = px[si + 2]
    xor[di + 1] = px[si + 1]
    xor[di + 2] = px[si]
    xor[di + 3] = px[si + 3]
  }
}
const andSize = ((W + 31) >> 5) * H * 4
const and = Buffer.alloc(andSize)
const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0)                  // reserved
icoHeader.writeUInt16LE(1, 2)                  // type: icon
icoHeader.writeUInt16LE(1, 4)                  // count
const dirEntry = Buffer.alloc(16)
dirEntry[0] = 0                                // 512 encoded as 0
dirEntry[1] = 0
dirEntry[2] = 1                                // colors
dirEntry[3] = 0
dirEntry.writeUInt16LE(1, 4)                   // planes
dirEntry.writeUInt16LE(32, 6)                  // bpp
dirEntry.writeUInt32LE(40 + xorSize + andSize, 8)
dirEntry.writeUInt32LE(22, 12)                 // offset after header+entry
const ico = Buffer.concat([icoHeader, dirEntry, bmpHeader, xor, and])
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico)
console.log(`[icon] wrote ${path.join(outDir, 'icon.ico')} (${ico.length} bytes)`)
