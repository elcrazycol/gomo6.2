import "./lib/polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { setupGlobalErrorHandlers } from "@/lib/logging";
import "./index.css";

// Capture uncaught errors and unhandled promise rejections.
const disposeGlobalErrorHandlers = setupGlobalErrorHandlers();

// A service worker update must not force-reload an active chat while the user
// is scrolling. The new worker will take effect on the next normal navigation
// or reload, without interrupting the current session.
const setupServiceWorkerReload = (): (() => void) => {
  if ('serviceWorker' in navigator) {
    const handler = () => {
      console.info('[pwa] update ready; keeping the current page alive');
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
