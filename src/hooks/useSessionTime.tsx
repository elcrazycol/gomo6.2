import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useSessionTime(userId: string | null) {
  useEffect(() => {
    if (!userId) return;

    let startTime = Date.now();
    let intervalId: NodeJS.Timeout;

    const updateSessionTime = async () => {
      const currentTime = Date.now();
      const minutesPassed = Math.floor((currentTime - startTime) / 60000);
      
      if (minutesPassed < 1) return;

      // Get current session time
      const { data: sessionData } = await supabase
        .from("user_session_time")
        .select("total_minutes")
        .eq("user_id", userId)
        .maybeSingle();

      const currentTotal = sessionData?.total_minutes || 0;
      const newTotal = currentTotal + minutesPassed;

      // Update or insert session time
      await supabase
        .from("user_session_time")
        .upsert({
          user_id: userId,
          total_minutes: newTotal,
          last_updated: new Date().toISOString(),
        });

      // Check for achievements
      if (currentTotal < 10 && newTotal >= 10) {
        await supabase.rpc("award_achievement", {
          _user_id: userId,
          _achievement_id: "time_10min",
        });
      }
      if (currentTotal < 30 && newTotal >= 30) {
        await supabase.rpc("award_achievement", {
          _user_id: userId,
          _achievement_id: "time_30min",
        });
      }
      if (currentTotal < 60 && newTotal >= 60) {
        await supabase.rpc("award_achievement", {
          _user_id: userId,
          _achievement_id: "time_1hour",
        });
      }
      if (currentTotal < 300 && newTotal >= 300) {
        await supabase.rpc("award_achievement", {
          _user_id: userId,
          _achievement_id: "time_5hours",
        });
      }

      startTime = currentTime;
    };

    // Update every minute
    intervalId = setInterval(updateSessionTime, 60000);

    // Update on page unload
    const handleUnload = () => {
      updateSessionTime();
    };

    window.addEventListener("beforeunload", handleUnload);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("beforeunload", handleUnload);
      updateSessionTime();
    };
  }, [userId]);
}