import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useOnlineStatus = (userId: string | undefined) => {
  useEffect(() => {
    if (!userId) return;

    // Update online status and last seen
    const updateStatus = async () => {
      await supabase
        .from("profiles")
        .update({
          is_online: true,
          last_seen_at: new Date().toISOString()
        })
        .eq("id", userId);
    };

    // Update on mount
    updateStatus();

    // Update every 30 seconds while active
    const interval = setInterval(updateStatus, 30000);

    // Update on visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        updateStatus();
      } else {
        // Set offline when tab is hidden
        supabase
          .from("profiles")
          .update({ is_online: false })
          .eq("id", userId);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Set offline on unmount
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      supabase
        .from("profiles")
        .update({ is_online: false })
        .eq("id", userId);
    };
  }, [userId]);
};
