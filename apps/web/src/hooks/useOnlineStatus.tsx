import { useEffect, useRef } from "react";
import { api } from "@/integrations/api/compat";

// Presence heartbeat interval (ms). Only fires a network write when the last
// known state differs — a user sitting on a page with the tab visible sends
// exactly ONE PUT per session instead of one every 25 seconds.
const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Best-effort presence: flips `is_online` on the user's profile row when the
 * tab becomes visible/hidden and on a slow heartbeat.
 *
 * Request reduction: the previous version PUT on every mount/unmount AND every
 * 25s tick (2.4 req/min idle + 2 PUTs per SPA navigation). Now a write happens
 * only when the state actually changes (online ⇄ offline), so idle traffic is
 * 0 requests/min and navigation still costs at most 2 (old page offline, new
 * page online).
 */
export const useOnlineStatus = (userId: string | undefined) => {
  // Last state successfully written to the server, per mount.
  const lastSentRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!userId) return;

    const setStatus = async (online: boolean) => {
      // Skip writes that would not change the server state.
      if (lastSentRef.current === online) return;
      try {
        await api
          .from("profiles")
          .update({
            is_online: online,
            last_seen_at: new Date().toISOString(),
          })
          .eq("id", userId);
        // Only remember a SUCCESSFUL write; a transient 429/5xx/401 is retried
        // by the next heartbeat tick instead of being swallowed forever.
        lastSentRef.current = online;
      } catch {
        // Presence is best-effort: swallow so the interval never surfaces an
        // unhandled promise rejection.
      }
    };

    const goOnline = () => setStatus(true);
    const goOffline = () => setStatus(false);

    // Initial heartbeat
    goOnline();

    // Heartbeat while tab is visible
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        goOnline();
      }
    }, HEARTBEAT_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        goOnline();
      } else {
        goOffline();
      }
    };

    const handleUnload = () => {
      goOffline();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
    };
  }, [userId]);
};
