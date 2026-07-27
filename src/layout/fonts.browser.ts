import { loadBundledFonts, type FontBook, type FontLoader } from './fonts'

/** Fonts ship in the app bundle and are fetched from its own origin. */
export const browserFontLoader: FontLoader = async (file) => {
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
