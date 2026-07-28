import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build variant used by `npm run build:single`: one IIFE bundle and one
// stylesheet with every asset inlined, which scripts/build-single.mjs then
// folds into a single self-contained .html file.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-single',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
})
