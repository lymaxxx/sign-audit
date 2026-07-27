import { loadBundledFonts, type FontBook, type FontLoader } from './fonts'

/**
 * Fonts embedded directly in the page.
 *
 * The single-file build has no server to fetch from — opened off a disk, every
 * request is a `file://` one and fails — so it inlines the font bytes here
 * instead.
 */
declare global {
  interface Window {
    __ALGACH_FONTS__?: Record<string, string>
  }
}

const decodeBase64 = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Fonts ship in the app bundle and are fetched from its own origin. */
export const browserFontLoader: FontLoader = async (file) => {
  const embedded = typeof window !== 'undefined' ? window.__ALGACH_FONTS__?.[file] : undefined
  if (embedded) return decodeBase64(embedded)

  const res = await fetch(`/fonts/${file}`)
  if (!res.ok) throw new Error(`Could not load font ${file}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

let cached: Promise<FontBook> | null = null

export const getFontBook = (): Promise<FontBook> => {
  cached ??= loadBundledFonts(browserFontLoader)
  return cached
}

/** Register a font the user supplied, so brand faces can be used and embedded. */
export const addUserFont = async (
  book: FontBook,
  family: string,
  weight: number,
  italic: boolean,
  data: Uint8Array,
): Promise<void> => {
  book.add({ family, weight, italic, file: `${family}-${weight}` }, data)
}
