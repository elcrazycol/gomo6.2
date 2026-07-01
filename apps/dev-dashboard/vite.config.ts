import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  // Dev Dashboard is served on dev.* subdomain in both dev and production.
  // Base is always '/' — no subpath prefix needed.
  server: {
    host: "::",
    port: 3002,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/oauth": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/storage": {
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
