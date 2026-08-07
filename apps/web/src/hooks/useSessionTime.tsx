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
      } catch (error) {
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

      // The auth client throws on 401/404 (e.g. after logout or when the write
      // endpoints are missing), which previously escaped as unhandledrejection
      // spam in the console. Catch everything and keep the local buffer.
      try {
        const wholeMinutes = Math.floor(accumulatedSeconds.current / 60);
        const leftoverSeconds = accumulatedSeconds.current % 60;

        if (!force && wholeMinutes < 1) {
          if (bufferKey) {
            localStorage.setItem(bufferKey, leftoverSeconds.toString());
          }
          return;
        }

        // Send the DELTA in a single atomic upsert. The backend accumulates
        // total_minutes on (user_id, session_date), so concurrent flushes (timer
        // + visibility/unload handlers overlapping) can neither trip the unique
        // constraint (plain INSERT -> 500) nor lose minutes (read-then-write race).
        const { error: upsertError } = await api
          .from("user_session_time")
          .upsert({
            user_id: userId,
            session_date: new Date().toISOString().split("T")[0],
            total_minutes: wholeMinutes,
          });

        if (upsertError) {
          console.error("[Session] Error updating session time:", upsertError);
          return;
        }

        accumulatedSeconds.current = leftoverSeconds;
        if (bufferKey) {
          localStorage.setItem(bufferKey, leftoverSeconds.toString());
        }
      } catch (error) {
        // 401 = session already logged out (expected during teardown) — stay
        // quiet, the auth layer handles the redirect. Other errors get logged.
        if ((error as { status?: number } | null)?.status !== 401) {
          console.error("[Session] Error flushing session time:", error);
        }
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
