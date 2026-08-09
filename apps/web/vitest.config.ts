import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      // text      — human-readable summary in CI logs
      // html      — per-file HTML report (published to Codeberg Pages)
      // json-summary — coverage-summary.json with machine-readable totals
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "../../coverage/frontend",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
