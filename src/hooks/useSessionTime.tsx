import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useSessionTime(userId: string | null) {
  const accumulatedMinutes = useRef(0);

  useEffect(() => {
    if (!userId) {
      console.log('[Session] No userId, skipping session tracking');
      return;
    }

    console.log('[Session] Starting session tracking for user:', userId);
    let startTime = Date.now();
    let intervalId: NodeJS.Timeout;

    // Регистрируем ежедневное посещение
    const registerDailyVisit = async () => {
      const { error } = await supabase
        .from("user_daily_visits")
        .insert({ user_id: userId })
        .select()
        .maybeSingle();
      
      if (error) {
        console.log('[Session] Daily visit already registered or error:', error.message);
      } else {
        console.log('[Session] Daily visit registered');
      }
    };

    // Регистрируем посещение при загрузке
    registerDailyVisit();

    const updateSessionTime = async () => {
      const currentTime = Date.now();
      const minutesPassed = Math.floor((currentTime - startTime) / 60000);
      
      console.log(`[Session] Update tick. Minutes passed since last: ${minutesPassed}, accumulated: ${accumulatedMinutes.current}`);
      
      // Always accumulate time, even if less than a minute
      if (minutesPassed > 0) {
        accumulatedMinutes.current += minutesPassed;
        startTime = currentTime;
      }

      // Only update DB if we have at least 1 minute accumulated
      if (accumulatedMinutes.current < 1) {
        console.log('[Session] Less than 1 minute accumulated, skipping DB update');
        return;
      }

      console.log(`[Session] Updating DB. Total accumulated: ${accumulatedMinutes.current} minutes`);

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

      console.log(`[Session] Current total: ${currentTotal}, adding: ${accumulatedMinutes.current}, new total: ${newTotal}`);

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

      console.log('[Session] Session time updated successfully');

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