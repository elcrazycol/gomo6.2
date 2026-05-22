import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8081,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/oauth": {
        target: "http://localhost:8080",
        changeOrigin: true,
        bypass: (req) => {
          if (req.url?.startsWith("/oauth/consent")) {
            return req.url; // return the URL to skip proxy — let Vite serve it as SPA route
          }
        },
      },
      "/rest": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/rpc": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/.well-known": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://localhost:8080",
        ws: true,
      },
      "/storage": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/federation": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/core"],
  },
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Enable proper hash-based cache busting
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    chunkSizeWarningLimit: 1000,
    // Enable source maps for debugging
    sourcemap: false,
  },
}));
