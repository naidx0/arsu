import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4780',
      '/sim': 'http://localhost:4780',
      '/ws': { target: 'ws://localhost:4780', ws: true },
    },
  },
});
