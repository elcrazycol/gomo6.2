import { useEffect } from "react";
import { api } from "@/integrations/api/compat";

export const useOnlineStatus = (userId: string | undefined) => {
  useEffect(() => {
    if (!userId) return;

    const setStatus = async (online: boolean) => {
      try {
        await api
          .from("profiles")
          .update({
            is_online: online,
            last_seen_at: online ? new Date().toISOString() : new Date().toISOString(),
          })
          .eq("id", userId);
      } catch {
        // Presence heartbeat is best-effort: a transient 429/5xx/401 is
        // retried by the next 25s tick. Swallow it so the setInterval callback
        // never surfaces an unhandled promise rejection.
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
    }, 25000);

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
