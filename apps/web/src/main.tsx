import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { setupGlobalErrorHandlers } from "@/lib/logging";
import "./index.css";

// Capture uncaught errors and unhandled promise rejections.
const disposeGlobalErrorHandlers = setupGlobalErrorHandlers();

// When a new service worker takes control (e.g. after a deployment),
// reload the page so the new app shell and chunks are used.
const setupServiceWorkerReload = (): (() => void) => {
  const handler = () => {
    window.location.reload();
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', handler);
  }

  return () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('controllerchange', handler);
    }
  };
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
