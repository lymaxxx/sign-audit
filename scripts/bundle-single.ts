import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLED_FONTS } from '../src/layout/fonts'
import { cssFamily } from '../src/render/svg'

/**
 * Folds the app into one HTML file that runs off a disk.
 *
 * No install, no server, no Rust: double-clicking it opens the whole thing in
 * a browser. Everything a `file://` page cannot fetch — the script, the styles
 * and the font binaries — is inlined instead.
 *
 * Reads what `vite build --config vite.config.single.ts` produced, which is
 * one plain script rather than a set of ES modules, because a page opened off
 * a disk can neither resolve chunk paths nor satisfy CORS for module scripts.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist-single')

const run = async () => {
  const js = await readFile(join(DIST, 'app.js'), 'utf8')
  const css = await readFile(join(DIST, 'app.css'), 'utf8')

  // Taken from the font registry rather than by reading the directory, so the
  // faces the browser is given are exactly the cuts the engine will measure.
  const fonts: Record<string, string> = {}
  const faces: string[] = []

  for (const cut of BUNDLED_FONTS) {
    const base64 = (await readFile(join(ROOT, 'fonts', cut.file))).toString('base64')
    fonts[cut.file] = base64
    faces.push(
      `@font-face{font-family:"${cssFamily(cut.family)}";font-weight:${cut.weight};` +
        `font-style:${cut.italic ? 'italic' : 'normal'};font-display:block;` +
        `src:url(data:font/ttf;base64,${base64}) format("truetype")}`,
    )
  }

  // Assembled by concatenation rather than by String.replace. A replacement
  // *string* gives `$` special meaning — "$`" stands for everything before the
  // match — and a minified bundle is full of those sequences, which turns one
  // substitution into a document that inlines itself over and over.
  const html = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>Timetable Generator</title>',
    '<style>',
    faces.join(''),
    css,
    '</style>',
    '<script>window.__TIMETABLE_FONTS__=',
    JSON.stringify(fonts),
    '</script>',
    '</head><body><div id="root"></div><script>',
    js,
    '</script></body></html>',
  ].join('')

  const out = join(ROOT, 'TimetableGenerator.html')
  await writeFile(out, html, 'utf8')

  const families = new Set(BUNDLED_FONTS.map((f) => f.family))
  console.log(
    `TimetableGenerator.html  ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB  ` +
      `(${BUNDLED_FONTS.length} cuts across ${families.size} families)`,
  )
}

await run()
