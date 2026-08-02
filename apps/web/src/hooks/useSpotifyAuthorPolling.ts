import { useEffect } from "react";
import { apiClient } from "@/integrations/api/client";

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
    if (!apiClient.getToken() && !apiClient.getCSRFToken()) return;

    let active = true;

    const poll = async () => {
      if (!active) return;
      try {
        await apiClient.request("/api/v1/integrations/spotify/me/state");
        // Response triggers WS publish on backend if state changed.
        // We don't need the data here — visitors receive it via WebSocket.
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
