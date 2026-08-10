import "./lib/polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { toast } from "@/components/ui/sonner";
import { setupGlobalErrorHandlers } from "@/lib/logging";
import "./index.css";
import "@/components/Lightbox.css";

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
  });
}
