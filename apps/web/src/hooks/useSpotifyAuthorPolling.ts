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

    // Once flipped to false, every later tick is a no-op (no network call).
    let active = true;

    const poll = async () => {
      if (!active) return;
      try {
        await apiClient.request("/api/v1/integrations/spotify/me/state");
        // Response triggers WS publish on backend if state changed.
        // We don't need the data here — visitors receive it via WebSocket.
      } catch (err) {
        // 503 = Spotify is not configured on the server (nothing will change
        // until the server is configured) and 401 = logged out. Polling either
        // forever would just spam the console, so stop in both cases.
        // Other errors (network, 5xx) — retry on the next tick.
        const status = (err as { status?: number } | null)?.status;
        if (status === 503 || status === 401) active = false;
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
