import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * The build behind the single-file bundle.
 *
 * Two departures from the normal one, both forced by `file://`: everything
 * goes into one chunk, because separate chunks would be `import`ed by path and
 * a page opened off a disk cannot resolve those; and the output is a plain
 * script rather than a module, because module scripts are subject to CORS and
 * a file has no origin to satisfy it with.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist-single',
    target: 'safari15',
    sourcemap: false,
    cssCodeSplit: false,
    rolldownOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
})
