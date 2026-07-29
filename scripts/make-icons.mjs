/**
 * Generates the PWA icons as PNGs, with no image library.
 *
 * A home-screen icon has to be a PNG — iOS ignores SVG for `apple-touch-icon`
 * — but pulling in a rasteriser to draw a rounded square and a signpost would
 * be a heavy dependency for three small files. PNG is a simple container:
 * a header chunk, one zlib-compressed block of scanlines, and an end marker.
 *
 * Run with `npm run icons` after changing the artwork.
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const BG = [0x12, 0x15, 0x1c]
const PLATE = [0x4c, 0x8d, 0xff]
const POST = [0x8b, 0x93, 0xa7]
const TEXT = [0x12, 0x15, 0x1c]

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function png(size, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: truecolour
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // Each scanline is prefixed with its filter type; 0 means "none".
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1)
    raw[rowStart] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixels(x, y)
      const offset = rowStart + 1 + x * 3
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A signpost: a rounded plate with two bars on it, standing on a post. */
function artwork(size) {
  const u = size / 100 // work in percentage units
  const inside = (x, y, left, top, right, bottom, radius = 0) => {
    if (x < left || x > right || y < top || y > bottom) return false
    if (!radius) return true
    const cx = Math.min(Math.max(x, left + radius), right - radius)
    const cy = Math.min(Math.max(y, top + radius), bottom - radius)
    return Math.hypot(x - cx, y - cy) <= radius
  }

  return (px, py) => {
    const x = px / u
    const y = py / u

    // Post first, so the plate paints over it.
    if (inside(x, y, 46, 56, 54, 84, 2)) return POST
    if (inside(x, y, 34, 84, 66, 89, 2)) return POST

    if (inside(x, y, 16, 16, 84, 62, 10)) {
      // Two "lines of text" on the plate.
      if (inside(x, y, 27, 29, 73, 36, 3)) return TEXT
      if (inside(x, y, 27, 43, 60, 50, 3)) return TEXT
      return PLATE
    }

    return BG
  }
}

mkdirSync(join(root, 'public'), { recursive: true })

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  const file = join(root, 'public', name)
  writeFileSync(file, png(size, artwork(size)))
  console.log(`wrote public/${name} (${size}x${size})`)
}
