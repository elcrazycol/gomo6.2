import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  // Docs is served on docs.* subdomain in both dev and production.
  // Base is always '/' — no subpath prefix needed.
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: "::",
    port: 3001,
    allowedHosts: true,
  },
})
