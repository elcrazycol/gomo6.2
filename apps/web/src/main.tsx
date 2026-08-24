import "./lib/polyfills";
import "./i18n";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { toast } from "@/components/ui/sonner";
import { setupGlobalErrorHandlers } from "@/lib/logging";
import { isNativePlatform, initCapacitor } from "@/lib/capacitor";
import { initMobileKeyboard } from "@/lib/mobileKeyboard";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import "@/components/Lightbox.css";

const nativePlatform = isNativePlatform();

// Inside the Capacitor native shell the keyboard plugin owns the geometry
// (lib/capacitor.ts publishes --app-vh / --kb-inset from native events); the
// visualViewport-based browser layer would fight it, so it is skipped there.
// Mobile virtual keyboard: tracks the visual viewport, publishes --app-vh /
// --kb-inset CSS variables and keeps the focused input above the keyboard.
const disposeMobileKeyboard = nativePlatform ? undefined : initMobileKeyboard();

// Native shell bootstrap (keyboard, status bar, app state) — no-op on web.
const disposeCapacitor = initCapacitor();

// Capture uncaught errors and unhandled promise rejections.
const disposeGlobalErrorHandlers = setupGlobalErrorHandlers();

// The service worker is registered manually (injectRegister: false in
// vite.config.ts) so it is never registered inside the Capacitor native shell
// — the native app needs no SW (push will go through APNs/FCM, not Web Push),
// and a precache inside the WebView would only waste storage. The reload-on-
// update flow below is driven by the controllerchange listener, so the
// plugin's own auto-reload is suppressed (onNeedReload: no-op).
if (!nativePlatform) {
  registerSW({ onNeedReload: () => undefined });
}

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
    return () => navigator.serviceWorker.removeEventListener('controllerchange', handler);
  }
  return () => undefined;
};
const disposeServiceWorkerReload = setupServiceWorkerReload();

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
    disposeMobileKeyboard?.();
    disposeCapacitor();
  });
}
