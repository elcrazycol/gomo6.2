import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useOnlineStatus = (userId: string | undefined) => {
  useEffect(() => {
    if (!userId) return;

    const setStatus = async (online: boolean) => {
      await supabase
        .from("profiles")
        .update({
          is_online: online,
          last_seen_at: online ? new Date().toISOString() : new Date().toISOString(),
        })
        .eq("id", userId);
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
