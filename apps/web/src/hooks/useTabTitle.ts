import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useMessengerStore } from "@/stores/messengerStore";

const BASE_TITLE = "gomo6";
const FLICKER_INTERVAL_MS = 500;

export function useTabTitle() {
  const location = useLocation();
  const totalUnread = useMessengerStore((s) => s.totalUnread());
  const flickerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isVisibleRef = useRef(!document.hidden);

  const stopFlicker = useCallback(() => {
    if (flickerTimerRef.current) {
      clearInterval(flickerTimerRef.current);
      flickerTimerRef.current = null;
    }
  }, []);

  const startFlicker = useCallback(
    (count: number) => {
      stopFlicker();
      let show = true;
      const unreadTitle = `(\u2009${count}\u2009) ${BASE_TITLE}`;
      flickerTimerRef.current = setInterval(() => {
        document.title = show ? unreadTitle : BASE_TITLE;
        show = !show;
      }, FLICKER_INTERVAL_MS);
    },
    [stopFlicker],
  );

  // Track tab visibility
  useEffect(() => {
    const onVisibilityChange = () => {
      const visible = !document.hidden;
      isVisibleRef.current = visible;
      if (visible && totalUnread > 0) {
        stopFlicker();
        document.title = `(\u2009${totalUnread}\u2009) ${BASE_TITLE}`;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [totalUnread, stopFlicker]);

  // React to unread count changes
  useEffect(() => {
    const onMessagesPage = location.pathname === "/messages";

    if (onMessagesPage || totalUnread === 0) {
      stopFlicker();
      document.title = BASE_TITLE;
      return;
    }

    if (isVisibleRef.current) {
      stopFlicker();
      document.title = `(\u2009${totalUnread}\u2009) ${BASE_TITLE}`;
    } else {
      startFlicker(totalUnread);
    }
  }, [totalUnread, location.pathname, stopFlicker, startFlicker]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopFlicker();
      document.title = BASE_TITLE;
    };
  }, [stopFlicker]);
}
