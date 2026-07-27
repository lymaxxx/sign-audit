import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadBundledFonts, type FontBook, type FontLoader } from './fonts'

/** Font loader for tests and the proof renderer. Not bundled into the app. */
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fonts')

export const nodeFontLoader: FontLoader = async (file) => new Uint8Array(await readFile(join(FONT_DIR, file)))

let cached: Promise<FontBook> | null = null

/** Fonts are immutable, so every caller in a run can share one book. */
export const getFontBook = (): Promise<FontBook> => {
  cached ??= loadBundledFonts(nodeFontLoader)
  return cached
}
