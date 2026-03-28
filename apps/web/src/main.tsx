import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Clear old cache versions and force refresh if needed
const clearOldCaches = async () => {
  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      console.log('Available caches:', cacheNames);

      // Clear all caches except current version
      await Promise.all(
        cacheNames.map(async (cacheName) => {
          if (!cacheName.includes('gomo6-') || !cacheName.includes('v1.0.1')) {
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
        if (!registration.scope.includes('gomo6-v1.0.1')) {
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
