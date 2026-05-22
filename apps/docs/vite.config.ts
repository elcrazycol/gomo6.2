import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  // Base path for production Docker deployment behind Caddy's /docs/* route.
  // In local dev (npm run dev) this is overridden to '/' by the dev server.
  base: process.env.NODE_ENV === 'production' ? '/docs/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3001,
  },
})
