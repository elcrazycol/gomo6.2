import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

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
            return req.url;
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
    // injectManifest strategy: the service worker is our own src/sw.ts (push /
    // notificationclick handlers) compiled by Vite, with the precache manifest
    // injected into __WB_MANIFEST. The app-shell + caching rules that used to
    // live in the generateSW `workbox` block now live in src/sw.ts.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "gomo6.png", "apple-touch-icon.png"],
      manifest: {
        name: "gomo6",
        short_name: "gomo6",
        description: "Мессенджер gomo6",
        theme_color: "#16a34a",
        background_color: "#f5f5f0",
        display: "standalone",
        orientation: "portrait",
        start_url: "/messages",
        scope: "/",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
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
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
        // Split heavy third-party libs out of the entry chunk. On slow
        // connections a single 1-3 MB entry file is brutal: one long download
        // that delays rendering and isn't cacheable separately. These chunks
        // download in parallel over HTTP/2 and cache independently.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("@bbob")) return "vendor-bbob";
          if (id.includes("@ffmpeg")) return "vendor-ffmpeg";
          if (id.includes("@tanstack")) return "vendor-query";
          if (id.includes("i18next")) return "vendor-i18n";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("@sentry")) return "vendor-sentry";
          // NOTE: @tiptap/prosemirror and recharts are intentionally NOT split
          // here. Both are only reachable through lazy chunks (GomoRichEditor,
          // Stats) — forcing them into a shared "vendor" chunk made the entry
          // statically import them, which dragged tiptap (~430 kB) into the
          // first-load critical path. Let Rollup keep them lazy.
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1000,
    sourcemap: false,
  },
}));
