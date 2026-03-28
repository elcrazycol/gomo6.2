import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const APP_CACHE_PREFIX = "gomo6-";

// Clear old cache versions and stale service workers aggressively after the broken preload deploy.
const clearOldCaches = async () => {
  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      console.log('Available caches:', cacheNames);

      // Remove all app-managed caches so clients don't keep bad module URLs.
      await Promise.all(
        cacheNames.map(async (cacheName) => {
          if (cacheName.includes(APP_CACHE_PREFIX)) {
            console.log('Deleting old cache:', cacheName);
            await caches.delete(cacheName);
          }
        })
      );
    } catch (error) {
      console.error('Error clearing old caches:', error);
    }
  }

  // Unregister old service workers
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        if (registration.scope.includes(window.location.origin)) {
          console.log('Unregistering old service worker:', registration.scope);
          await registration.unregister();
        }
      }
    } catch (error) {
      console.error('Error unregistering old service workers:', error);
    }
  }
};

// Clear caches on app start
clearOldCaches();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
