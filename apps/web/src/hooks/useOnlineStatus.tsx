import { useEffect } from "react";
import { api } from "@/integrations/api/compat";

// Presence heartbeat interval (ms). Only fires a network write when the last
// known state differs — a user sitting on a page with the tab visible sends
// exactly ONE PUT per session instead of one every 25 seconds.
const HEARTBEAT_INTERVAL_MS = 60_000;

// SESSION-scoped last-written state (module scope, NOT per mount). The hook is
// mounted by every routed page (Board, Thread, Index, …), so a per-component
// ref would re-PUT "online" on every SPA navigation (~1 PUT per click — the
// 59 PUT /profiles per session seen in metrics). The module-level ref survives
// remounts within the same page session: the first mount writes online,
// subsequent page mounts see it and skip the write, and an actual offline
// transition (page unloaded) resets it.
let sessionLastSent: boolean | null = null;

/**
 * Best-effort presence: flips `is_online` on the user's profile row when the
 * tab becomes visible/hidden and on a slow heartbeat.
 *
 * Request reduction: the previous version PUT on every mount/unmount AND every
 * 25s tick (2.4 req/min idle + 2 PUTs per SPA navigation). Now a write happens
 * only when the state actually changes (online ⇄ offline) and only the FIRST
 * page mount of a session writes online — idle traffic is 0 requests/min and
 * SPA navigation costs 0 PUTs.
 *
 * Why we DON'T write offline when the tab is hidden: the server already owns
 * `is_online` via the WebSocket hub (writes true on connect, false on
 * disconnect, debounced). A client-side "offline" PUT on tab-hide would
 * conflict with that source of truth — e.g. another visible tab of the same
 * user would never re-write online because its session ref is already true,
 * leaving the user stuck "offline" until reload. By deferring to the hub,
 * hiding a tab (which keeps the WS alive) correctly keeps the user online,
 * and closing the tab drops the WS so the hub flips the flag itself.
 */
export const useOnlineStatus = (userId: string | undefined) => {
  useEffect(() => {
    if (!userId) return;

    const setStatus = async (online: boolean) => {
      // Skip writes that would not change the server state. Reading the
      // module-level value directly (no ref mirror) avoids the race where a
      // re-render during an in-flight write reset the ref to a stale value.
      if (sessionLastSent === online) return;
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
        sessionLastSent = online;
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

    // Tab becomes visible → (re)assert online. Tab hidden → do NOT write
    // offline: the WebSocket hub owns the offline transition (see docblock).
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        goOnline();
      }
    };

    // Real navigation away / tab close: best-effort offline write (also
    // resets the session ref so the next page load writes online again).
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
