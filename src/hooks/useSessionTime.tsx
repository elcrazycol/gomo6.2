import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useSessionTime(userId: string | null) {
  const accumulatedMinutes = useRef(0);

  useEffect(() => {
    if (!userId) return;

    let startTime = Date.now();
    let intervalId: NodeJS.Timeout;

    // Регистрируем ежедневное посещение
    const registerDailyVisit = async () => {
      await supabase
        .from("user_daily_visits")
        .insert({ user_id: userId })
        .select()
        .maybeSingle();
    };

    // Регистрируем посещение при загрузке
    registerDailyVisit();

    const updateSessionTime = async () => {
      const currentTime = Date.now();
      const minutesPassed = Math.floor((currentTime - startTime) / 60000);
      
      if (minutesPassed < 1) return;

      accumulatedMinutes.current += minutesPassed;

      // Get current session time
      const { data: sessionData } = await supabase
        .from("user_session_time")
        .select("total_minutes")
        .eq("user_id", userId)
        .maybeSingle();

      const currentTotal = sessionData?.total_minutes || 0;
      const newTotal = currentTotal + accumulatedMinutes.current;

      // Update or insert session time
      const { error } = await supabase
        .from("user_session_time")
        .upsert({
          user_id: userId,
          total_minutes: newTotal,
          last_updated: new Date().toISOString(),
        }, {
          onConflict: 'user_id'
        });

      if (!error) {
        // Check for achievements only if update was successful
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

        // Reset accumulated minutes after successful update
        accumulatedMinutes.current = 0;
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