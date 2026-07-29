import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Deployed as a GitHub Pages *project* site at https://<user>.github.io/algach/,
// so every asset URL needs the repo name as a prefix. Override with BASE_PATH=/
// when serving from a domain root.
const base = process.env.BASE_PATH ?? '/algach/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Signage Audit',
        short_name: 'Signage',
        description: 'Field audits of signage against a CAD plan.',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#12151c',
        theme_color: '#12151c',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Audits happen in basements and car parks, so the whole shell is
        // precached and the app opens with no signal at all.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
