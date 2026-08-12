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
    VitePWA({
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
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Don't intercept backend routes with the SPA shell; Caddy proxies
        // /oauth/* and /api/* to the Go backend, and serving index.html for
        // them causes the SPA's own 404 page to be returned.
        navigateFallbackDenylist: [/^\/api\//, /^\/oauth\//],
        runtimeCaching: [
          {
            // L2 (security audit): the conversation list carries decrypted
            // message previews — never persist it offline; NetworkFirst only
            // falls back to the cache when the network is unreachable, and the
            // entry is purged on logout (see client.ts logout()).
            urlPattern: /^https:\/\/.*\/api\/v1\/messenger\/conversations$/,
            handler: "NetworkFirst",
            options: { cacheName: "messenger-conversations", expiration: { maxEntries: 1, maxAgeSeconds: 300 } },
          },
          {
            // L2 (security audit): only PUBLIC buckets may be cached. The
            // "uploads" and "wall" buckets are privacy-gated server-side
            // (per-wall authorization) — caching them client-side would keep
            // private images in the browser Cache Storage after logout or
            // access revocation. The negative lookahead keeps CacheFirst for
            // avatars/post-images/content/emojis/gift-layers only. The -v2
            // cache name forces a clean cache on deploy: entries cached under
            // the previous all-buckets regex must not survive the upgrade.
            urlPattern: /^https:\/\/.*\/storage\/v1\/object\/(?!uploads\/|wall\/)/,
            handler: "CacheFirst",
            options: { cacheName: "storage-objects-v2", expiration: { maxEntries: 50, maxAgeSeconds: 86400 * 30 } },
          },
        ],
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
      },
    },
    chunkSizeWarningLimit: 1000,
    sourcemap: false,
  },
}));
