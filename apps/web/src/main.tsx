import "./instrument"; // MUST be the first import — Sentry.init() before anything else
import "./lib/polyfills";
import "./i18n";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { toast } from "@/components/ui/sonner";
import { setupGlobalErrorHandlers } from "@/lib/logging";
import { initMobileKeyboard } from "@/lib/mobileKeyboard";
import { initPerfTier } from "@/utils/perfTier";
import "./index.css";
import "@/theme/theme.css";
import { initCustomThemes } from "@/theme";

// Register stored custom themes before any component reads a theme preference.
initCustomThemes();
import "@/components/Lightbox.css";

// Mobile virtual keyboard: tracks the visual viewport, publishes --app-vh /
// --kb-inset CSS variables and keeps the focused input above the keyboard.
const disposeMobileKeyboard = initMobileKeyboard();

// Classify the device once and put weak hardware on the cheap glass tier
// (html.perf-lite) before the header ever paints.
initPerfTier();

// Capture uncaught errors and unhandled promise rejections.
const disposeGlobalErrorHandlers = setupGlobalErrorHandlers();

// When a new build is deployed, the updated service worker takes control and
// deletes the old precached chunks (cleanupOutdatedCaches). An open tab still
// running the old code would then 404 on its next lazy import, so we reload
// the tab right away — with a toast so the user knows why. The `hadController`
// guard skips the very first activation (no previous version to upgrade), so
// first-time visitors don't get a double load.
const setupServiceWorkerReload = (): (() => void) => {
  if ('serviceWorker' in navigator) {
    // Stateful: the first activation after install (null → SW) is not an
    // update, so we skip the reload once. Any later controllerchange means a
    // new build took over — reload so the tab never runs stale chunks.
    let hadController = !!navigator.serviceWorker.controller;
    const handler = () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      console.info('[pwa] update ready; reloading to the latest version');
      toast('Приложение обновлено. Перезагружаем…');
      window.setTimeout(() => window.location.reload(), 1500);
    };
    navigator.serviceWorker.addEventListener('controllerchange', handler);

    // ── Active update checks ──────────────────────────────────────────────
    // Browsers only check for a new service worker on hard navigations (and
    // roughly every 24h). An open tab or installed PWA would otherwise never
    // notice a deploy. registration.update() fetches sw.js; when its content
    // changed the browser installs the new SW, whose self.skipWaiting()
    // activates it → controllerchange above → reload with the fresh build.
    // Checks run when the tab becomes visible/focused again (cheap, catches
    // deploys that happened while the tab sat in the background) and once an
    // hour as a safety net for long-lived tabs.
    let disposed = false;
    const checkForUpdates = () => {
      if (disposed) return;
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          if (reg) reg.update().catch(() => {});
        })
        .catch(() => {});
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkForUpdates();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', checkForUpdates);
    const updateInterval = window.setInterval(checkForUpdates, 60 * 60 * 1000);

    return () => {
      disposed = true;
      window.clearInterval(updateInterval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', checkForUpdates);
      navigator.serviceWorker.removeEventListener('controllerchange', handler);
    };
  }
  return () => undefined;
};
const disposeServiceWorkerReload = setupServiceWorkerReload();

// A dynamic `import()` (a lazy route/feature chunk) fails when the freshly
// activated service worker has already purged the previous build's chunks —
// the classic "Importing a module script failed." on iOS right after a deploy.
// Vite dispatches `vite:preloadError` on window in that case; reload once so
// the tab picks up the new build instead of dying on a blank screen. The retry
// is rate-limited to one per 10s so a genuinely broken deploy can't trap the
// user in a reload loop.
const setupPreloadErrorReload = (): (() => void) => {
  const RETRY_KEY = "gomo6:preload-retry-at";
  const onPreloadError = (event: Event) => {
    event.preventDefault();
    let lastRetry = 0;
    try {
      lastRetry = Number(sessionStorage.getItem(RETRY_KEY) || 0);
    } catch {
      /* storage blocked */
    }
    if (Date.now() - lastRetry < 10_000) return;
    try {
      sessionStorage.setItem(RETRY_KEY, String(Date.now()));
    } catch {
      /* storage blocked */
    }
    console.warn("[pwa] chunk load failed; reloading for the latest build");
    window.location.reload();
  };
  window.addEventListener("vite:preloadError", onPreloadError);
  return () => window.removeEventListener("vite:preloadError", onPreloadError);
};
const disposePreloadErrorReload = setupPreloadErrorReload();

// Expose for debugging and for other entry points.
export { logClientError } from "@/lib/logging";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Clean up global listeners on hot reload in development.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeGlobalErrorHandlers();
    disposeServiceWorkerReload();
    disposePreloadErrorReload();
    disposeMobileKeyboard();
  });
}
