import opentype from 'opentype.js'
import { ptToMm } from '../model/units'
import type { TextStyle } from '../model/template'

/**
 * Text is measured against real font metrics rather than the DOM.
 *
 * That is what lets the preview and the PDF agree: both consume geometry
 * computed here, so a departure that clears its column on screen clears it on
 * the press. It also means the layout engine runs headless, under test.
 */

export interface FontCut {
  family: string
  weight: number
  italic: boolean
  file: string
}

export const PLEX_FAMILY = 'plex'
export const PLEX_CONDENSED_FAMILY = 'plex-condensed'

/** The cuts shipped with the app. Users can register more at runtime. */
export const BUNDLED_FONTS: FontCut[] = [
  { family: PLEX_FAMILY, weight: 100, italic: false, file: 'IBMPlexSans-Thin.ttf' },
  { family: PLEX_FAMILY, weight: 300, italic: false, file: 'IBMPlexSans-Light.ttf' },
  { family: PLEX_FAMILY, weight: 400, italic: false, file: 'IBMPlexSans-Regular.ttf' },
  { family: PLEX_FAMILY, weight: 450, italic: false, file: 'IBMPlexSans-Text.ttf' },
  { family: PLEX_FAMILY, weight: 500, italic: false, file: 'IBMPlexSans-Medium.ttf' },
  { family: PLEX_FAMILY, weight: 600, italic: false, file: 'IBMPlexSans-SemiBold.ttf' },
  { family: PLEX_FAMILY, weight: 700, italic: false, file: 'IBMPlexSans-Bold.ttf' },
  { family: PLEX_CONDENSED_FAMILY, weight: 300, italic: false, file: 'IBMPlexSansCondensed-Light.ttf' },
  { family: PLEX_CONDENSED_FAMILY, weight: 400, italic: false, file: 'IBMPlexSansCondensed-Regular.ttf' },
  { family: PLEX_CONDENSED_FAMILY, weight: 500, italic: false, file: 'IBMPlexSansCondensed-Medium.ttf' },
  { family: PLEX_CONDENSED_FAMILY, weight: 600, italic: false, file: 'IBMPlexSansCondensed-SemiBold.ttf' },
  { family: PLEX_CONDENSED_FAMILY, weight: 700, italic: false, file: 'IBMPlexSansCondensed-Bold.ttf' },
]

export interface LoadedFont {
  key: string
  family: string
  weight: number
  italic: boolean
  font: opentype.Font
  /** Bytes kept for embedding a subset into the PDF. */
  data: Uint8Array
  unitsPerEm: number
  /** Ascent and descent as a fraction of the em. */
  ascent: number
  descent: number
}

export const fontKey = (family: string, weight: number, italic: boolean): string =>
  `${family}/${weight}${italic ? 'i' : ''}`

/** Bytes for one font file, however the host happens to get them. */
export type FontLoader = (file: string) => Promise<Uint8Array>

const toArrayBuffer = (u8: Uint8Array): ArrayBuffer =>
  u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer

export class FontBook {
  private cuts = new Map<string, LoadedFont>()
  private families = new Set<string>()

  add(cut: FontCut, data: Uint8Array): LoadedFont {
    const font = opentype.parse(toArrayBuffer(data))
    const unitsPerEm = font.unitsPerEm
    const loaded: LoadedFont = {
      key: fontKey(cut.family, cut.weight, cut.italic),
      family: cut.family,
      weight: cut.weight,
      italic: cut.italic,
      font,
      data,
      unitsPerEm,
      ascent: font.ascender / unitsPerEm,
      descent: font.descender / unitsPerEm,
    }
    this.cuts.set(loaded.key, loaded)
    this.families.add(cut.family)
    return loaded
  }

  familyNames(): string[] {
    return [...this.families]
  }

  /** Available weights for a family, ascending. */
  weightsFor(family: string): number[] {
    return [...this.cuts.values()]
      .filter((c) => c.family === family)
      .map((c) => c.weight)
      .sort((a, b) => a - b)
  }

  /**
   * Nearest available cut. A template asking for a weight the family does not
   * have gets the closest one rather than failing to render.
   */
  resolve(family: string, weight: number, italic = false): LoadedFont {
    const exact = this.cuts.get(fontKey(family, weight, italic))
    if (exact) return exact

    const candidates = [...this.cuts.values()].filter((c) => c.family === family)
    const pool = candidates.length > 0 ? candidates : [...this.cuts.values()]
    if (pool.length === 0) throw new Error('No fonts loaded')

    let best = pool[0]!
    let bestCost = Infinity
    for (const c of pool) {
      const cost = Math.abs(c.weight - weight) + (c.italic === italic ? 0 : 50)
      if (cost < bestCost) {
        best = c
        bestCost = cost
      }
    }
    return best
  }

  resolveStyle(style: TextStyle): LoadedFont {
    return this.resolve(style.family, style.weight, style.italic)
  }

  /** Type size in millimetres, after the block's scale is applied. */
  sizeMm(style: TextStyle, scale: number): number {
    return ptToMm(style.sizePt) * scale
  }

  /**
   * Advance width in millimetres.
   *
   * Tracking is counted between glyphs only, not trailing — a tracked label
   * stays optically flush with the column edge it sits against.
   */
  measure(text: string, style: TextStyle, scale: number): number {
    if (text.length === 0) return 0
    const font = this.resolveStyle(style)
    const size = this.sizeMm(style, scale)
    const advance = font.font.getAdvanceWidth(text, size, { kerning: true })
    const gaps = Math.max(0, [...text].length - 1)
    return advance + gaps * style.tracking * size
  }

  /** Per-glyph advances, for laying out tracked text one glyph at a time. */
  advances(text: string, style: TextStyle, scale: number): number[] {
    const font = this.resolveStyle(style)
    const size = this.sizeMm(style, scale)
    return [...text].map((ch) => font.font.getAdvanceWidth(ch, size, { kerning: false }))
  }

  lineHeight(style: TextStyle, scale: number): number {
    return this.sizeMm(style, scale) * style.lineHeight
  }

  /** Distance from the top of a line box down to the baseline. */
  baselineOffset(style: TextStyle, scale: number): number {
    const font = this.resolveStyle(style)
    const size = this.sizeMm(style, scale)
    const leading = this.lineHeight(style, scale) - size * (font.ascent - font.descent)
    return leading / 2 + size * font.ascent
  }

  /** Glyph outlines as an SVG path, for the outlined-text export option. */
  outline(text: string, style: TextStyle, scale: number, x: number, y: number): string {
    const font = this.resolveStyle(style)
    const size = this.sizeMm(style, scale)
    return font.font.getPath(text, x, y, size, { kerning: true }).toPathData(3)
  }

  all(): LoadedFont[] {
    return [...this.cuts.values()]
  }
}

/** Load every bundled cut. Fonts are needed before the first layout pass. */
export const loadBundledFonts = async (loader: FontLoader): Promise<FontBook> => {
  const book = new FontBook()
  await Promise.all(
    BUNDLED_FONTS.map(async (cut) => {
      const data = await loader(cut.file)
      book.add(cut, data)
    }),
  )
  return book
}

/**
 * Break text into lines that fit a width.
 * Falls back to breaking mid-word only when a single word cannot fit at all.
 */
export const wrapText = (
  book: FontBook,
  text: string,
  style: TextStyle,
  scale: number,
  maxWidth: number,
): string[] => {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const lines: string[] = []
  let current = ''

  const push = () => {
    if (current) lines.push(current)
    current = ''
  }

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (book.measure(candidate, style, scale) <= maxWidth || !current) {
      if (book.measure(candidate, style, scale) <= maxWidth) {
        current = candidate
        continue
      }
      // A single word wider than the column: hard-break it.
      let chunk = ''
      for (const ch of word) {
        if (chunk && book.measure(chunk + ch, style, scale) > maxWidth) {
          lines.push(chunk)
          chunk = ch
        } else {
          chunk += ch
        }
      }
      current = chunk
      continue
    }
    push()
    current = word
  }
  push()
  return lines
}
