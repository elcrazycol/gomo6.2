import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useSessionTime(userId: string | null) {
  const accumulatedMinutes = useRef(0);

  useEffect(() => {
    if (!userId) {
      return;
    }
    let startTime = Date.now();
    let intervalId: NodeJS.Timeout;

    // Регистрируем ежедневное посещение
    const registerDailyVisit = async () => {
      const { error } = await supabase
        .from("user_daily_visits")
        .upsert({
          user_id: userId,
          visit_date: new Date().toISOString().split('T')[0]
        }, {
          onConflict: 'user_id,visit_date'
        });
      
      if (error) {
        console.error('[Session] Error registering daily visit:', error.message);
      }
    };

    // Регистрируем посещение при загрузке
    registerDailyVisit();

    const updateSessionTime = async () => {
      const currentTime = Date.now();
      const minutesPassed = Math.floor((currentTime - startTime) / 60000);
      
      // Always accumulate time, even if less than a minute
      if (minutesPassed > 0) {
        accumulatedMinutes.current += minutesPassed;
        startTime = currentTime;
      }

      // Only update DB if we have at least 1 minute accumulated
      if (accumulatedMinutes.current < 1) {
        return;
      }

      // Get current session time
      const { data: sessionData, error: fetchError } = await supabase
        .from("user_session_time")
        .select("total_minutes")
        .eq("user_id", userId)
        .maybeSingle();

      if (fetchError) {
        console.error('[Session] Error fetching session time:', fetchError);
        return;
      }

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

      if (error) {
        console.error('[Session] Error updating session time:', error);
        return;
      }

      // Time-based achievements are now handled by database trigger
      // The check_time_based_achievements function will be called automatically

      // Reset accumulated minutes after successful update
      accumulatedMinutes.current = 0;
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