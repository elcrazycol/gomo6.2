import { useEffect } from "react";

/**
 * Polls GET /api/v1/integrations/spotify/me/state every 10 seconds.
 * The backend fetches from Spotify, deduplicates, and publishes to viewers
 * only when the track state actually changes.
 *
 * This replaces the backend poller for logged-in users with the app open.
 * Mount once at the app root (App.tsx).
 */
export function useSpotifyAuthorPolling() {
  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) return;

    let active = true;

    const poll = async () => {
      if (!active) return;
      try {
        const res = await fetch("/api/v1/integrations/spotify/me/state", {
          headers: { Authorization: `Bearer ${token}` },
        });
        // Response triggers WS publish on backend if state changed.
        // We don't need the data here — visitors receive it via WebSocket.
        if (res.status === 401) {
          // Token expired — stop polling, let auth handle it
          active = false;
          return;
        }
        void res.json(); // consume body, result comes via WS to visitors
      } catch {
        // Silent fail — will retry on next tick
      }
    };

    // Initial poll after a short delay (don't compete with page load)
    const initialTimeout = setTimeout(poll, 3000);

    // Poll every 10s
    const interval = setInterval(poll, 10000);

    return () => {
      active = false;
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);
}
