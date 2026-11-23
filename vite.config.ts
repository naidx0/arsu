import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Kin',
        short_name: 'Kin',
        description: 'A health companion for people far from care.',
        theme_color: '#0b57d0',
        background_color: '#f8fafd',
        display: 'standalone',
        start_url: '.',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,woff2,json}'], maximumFileSizeToCacheInBytes: 4_000_000 },
    }),
  ],
  server: { port: 4790, strictPort: true },
  test: { include: ['tests/*.test.ts'] },
});
