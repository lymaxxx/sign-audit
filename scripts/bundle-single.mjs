import { readFile, writeFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const WEIGHTS = { Thin: 100, Light: 300, Regular: 400, Text: 450, Medium: 500, SemiBold: 600, Bold: 700 }

const run = async () => {
  const js = await readFile(join(DIST, 'app.js'), 'utf8')
  const css = await readFile(join(DIST, 'app.css'), 'utf8')

  // The fonts serve twice over: the engine reads the bytes to measure text,
  // and the browser needs the same faces to draw the preview.
  const fontFiles = (await readdir(join(ROOT, 'fonts'))).filter((f) => f.endsWith('.ttf'))
  const fonts = Object.fromEntries(
    await Promise.all(
      fontFiles.map(async (file) => [file, (await readFile(join(ROOT, 'fonts', file))).toString('base64')]),
    ),
  )

  const fontFaces = fontFiles
    .map((file) => {
      const cut = /-(Thin|Light|Regular|Text|Medium|SemiBold|Bold)\.ttf$/.exec(file)?.[1] ?? 'Regular'
      const family = file.startsWith('IBMPlexSansCondensed') ? 'algach-plex-condensed' : 'algach-plex'
      return (
        `@font-face{font-family:"${family}";font-weight:${WEIGHTS[cut]};font-style:normal;` +
        `font-display:block;src:url(data:font/ttf;base64,${fonts[file]}) format("truetype")}`
      )
    })
    .join('')

  // Assembled by concatenation rather than by String.replace. A replacement
  // *string* gives `$` special meaning — "$`" stands for everything before the
  // match — and a minified bundle is full of those sequences, which turns one
  // substitution into a document that inlines itself over and over.
  const html = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>Algach — transit schedules</title>',
    '<style>',
    fontFaces,
    css,
    '</style>',
    '<script>window.__ALGACH_FONTS__=',
    JSON.stringify(fonts),
    '</script>',
    '</head><body><div id="root"></div><script>',
    js,
    '</script></body></html>',
  ].join('')

  const out = join(ROOT, 'Algach.html')
  await writeFile(out, html, 'utf8')
  console.log(`Algach.html  ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB  (${fontFiles.length} fonts inlined)`)
}

await run()
