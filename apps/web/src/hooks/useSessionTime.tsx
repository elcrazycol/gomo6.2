import { useEffect, useRef } from "react";
import { api } from "@/integrations/api/compat";

export function useSessionTime(userId: string | null) {
  const accumulatedSeconds = useRef(0);
  const lastMark = useRef<number | null>(null);
  const bufferKey = userId ? `session-seconds-buffer-${userId}` : null;

  useEffect(() => {
    if (!userId) {
      return;
    }

    // восстановить буфер неполной минуты из localStorage
    if (bufferKey) {
      const buffered = Number(localStorage.getItem(bufferKey));
      if (!Number.isNaN(buffered) && buffered > 0) {
        accumulatedSeconds.current = buffered;
      }
    }

    const registerDailyVisit = async () => {
      try {
        const { error } = await api
          .from("user_daily_visits")
          .upsert({
            user_id: userId,
            visit_date: new Date().toISOString().split("T")[0],
          });

        if (error) {
          console.error("[Session] Error registering daily visit:", (error as { message?: string }).message);
        }
      } catch {
        console.error("[Session] Daily visit endpoint unavailable:", error);
      }
    };

    // Помечаем старт активного периода
    const markActivity = () => {
      const now = Date.now();
      if (lastMark.current !== null) {
        const deltaSeconds = Math.max(
          0,
          Math.floor((now - lastMark.current) / 1000)
        );
        // Считаем только когда вкладка видима
        if (!document.hidden) {
          accumulatedSeconds.current += deltaSeconds;
        }
      }
      lastMark.current = now;
    };

    const flushSession = async (force = false) => {
      markActivity();

      const wholeMinutes = Math.floor(accumulatedSeconds.current / 60);
      const leftoverSeconds = accumulatedSeconds.current % 60;

      if (!force && wholeMinutes < 1) {
        if (bufferKey) {
          localStorage.setItem(bufferKey, leftoverSeconds.toString());
        }
        return;
      }

      const { data: sessionData, error: fetchError } = await api
        .from("user_session_time")
        .select("id, total_minutes")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        console.error("[Session] Error fetching session time:", fetchError);
        return;
      }

      const currentTotal = sessionData?.total_minutes || 0;
      const newTotal = currentTotal + wholeMinutes;

      const updatePayload = {
        total_minutes: newTotal,
        updated_at: new Date().toISOString(),
      };

      const sessionRowId = sessionData?.id;
      const { error: upsertError } = sessionRowId
        ? await api
            .from("user_session_time")
            .update(updatePayload)
            .eq("id", sessionRowId)
        : await api.from("user_session_time").insert({
            user_id: userId,
            ...updatePayload,
            session_date: new Date().toISOString().split("T")[0],
          });

      if (upsertError) {
        console.error("[Session] Error updating session time:", upsertError);
        return;
      }

      accumulatedSeconds.current = leftoverSeconds;
      if (bufferKey) {
        localStorage.setItem(bufferKey, leftoverSeconds.toString());
      }
    };

    registerDailyVisit();
    lastMark.current = Date.now();

    // Обновляем чаще и на смену видимости
    const intervalId = setInterval(() => flushSession(false), 30000);
    const visibilityHandler = () => {
      if (document.hidden) {
        flushSession(true);
      } else {
        lastMark.current = Date.now();
      }
    };
    const unloadHandler = () => flushSession(true);

    document.addEventListener("visibilitychange", visibilityHandler);
    window.addEventListener("pagehide", unloadHandler);
    window.addEventListener("beforeunload", unloadHandler);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", visibilityHandler);
      window.removeEventListener("pagehide", unloadHandler);
      window.removeEventListener("beforeunload", unloadHandler);
      flushSession(true);
    };
  }, [userId, bufferKey]);
}
