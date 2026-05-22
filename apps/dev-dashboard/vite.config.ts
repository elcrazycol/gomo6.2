import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  // Base path for production Docker deployment behind Caddy's /dev/* route.
  // In local dev (npm run dev) this is overridden to '/' by the dev server.
  base: process.env.NODE_ENV === 'production' ? '/dev/' : '/',
  server: {
    host: "::",
    port: 3002,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/oauth": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
