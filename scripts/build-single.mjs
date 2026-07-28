// Folds the `vite.single.config.js` output into one self-contained HTML file
// that runs by double-clicking it — no server, no build step, no node_modules.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist-single')
const target = join(out, 'transit-map-generator.html')

execFileSync('npx', ['vite', 'build', '--config', 'vite.single.config.js'], {
  cwd: root,
  stdio: 'inherit',
})

const js = readFileSync(join(out, 'app.js'), 'utf8')
const css = existsSync(join(out, 'app.css')) ? readFileSync(join(out, 'app.css'), 'utf8') : ''
const favicon = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8')

// A closing tag inside a string literal would end the inline script early.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>')

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Transit Map Generator</title>
    <meta
      name="description"
      content="Trace bus and tram routes on OpenStreetMap data, then generate a clean schematic transit diagram."
    />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}" />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
${safeJs}
    </script>
  </body>
</html>
`

writeFileSync(target, html)
for (const leftover of ['index.html', 'app.js', 'app.css', 'favicon.svg']) {
  rmSync(join(out, leftover), { force: true })
}

const kb = (Buffer.byteLength(html) / 1024).toFixed(0)
console.log(`\nSelf-contained build: dist-single/transit-map-generator.html (${kb} kB)`)
console.log('Open it directly in a browser — no server needed.')
