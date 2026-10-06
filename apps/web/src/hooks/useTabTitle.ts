import { useCallback, useEffect, useRef } from "react";
import { useMessengerStore } from "@/stores/messengerStore";
import { applyUnreadBadges } from "@/utils/unreadBadges";

const BASE_TITLE = "gomo6";

/** `(N) gomo6` while there is something to read, plain `gomo6` otherwise. */
export function formatUnreadTitle(count: number): string {
  return count > 0 ? `(\u2009${count}\u2009) ${BASE_TITLE}` : BASE_TITLE;
}

// A bounded attention pulse for a NEW message that lands while the tab is
// hidden. Background tabs throttle timers (>=1s, and far worse after a few
// minutes), so the old infinite 500ms blink was both irritating and
// non-deterministic. We flip a few times and then settle on the static count:
// the persistent signal is the favicon / OS badge, not a blinking title.
const PULSE_INTERVAL_MS = 1100;
const PULSE_STEPS = 3; // count → base → count → base, then settle on the count

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Keeps the document title (`(N) gomo6`) and the out-of-tab unread indicators
 * in sync with the messenger's total unread count.
 *
 * The title itself is always static; it only gets a short, bounded pulse when
 * a new message arrives while the tab is in the background. There is no route
 * special-casing: the conversation the user has open already reports
 * `unread_count = 0`, so the counter naturally reflects the *other* chats.
 */
export function useTabTitle() {
  const totalUnread = useMessengerStore((s) => s.totalUnread());

  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCountRef = useRef(totalUnread);
  const isVisibleRef = useRef(typeof document === "undefined" ? true : !document.hidden);

  const stopPulse = useCallback(() => {
    if (pulseTimerRef.current !== null) {
      clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = null;
    }
  }, []);

  const startPulse = useCallback(
    (count: number) => {
      stopPulse();
      document.title = formatUnreadTitle(count);
      let step = 0;
      const tick = () => {
        if (step >= PULSE_STEPS) {
          document.title = formatUnreadTitle(count);
          pulseTimerRef.current = null;
          return;
        }
        document.title = step % 2 === 0 ? BASE_TITLE : formatUnreadTitle(count);
        step += 1;
        pulseTimerRef.current = setTimeout(tick, PULSE_INTERVAL_MS);
      };
      pulseTimerRef.current = setTimeout(tick, PULSE_INTERVAL_MS);
    },
    [stopPulse],
  );

  // Single source of truth: the title and the badges are derived from the
  // unread count, so one effect owns all writes (no inter-effect races).
  useEffect(() => {
    const previous = prevCountRef.current;
    prevCountRef.current = totalUnread;

    applyUnreadBadges(totalUnread);

    const shouldPulse =
      totalUnread > 0 &&
      totalUnread > previous &&
      !isVisibleRef.current &&
      !prefersReducedMotion();

    if (shouldPulse) {
      startPulse(totalUnread);
    } else {
      stopPulse();
      document.title = formatUnreadTitle(totalUnread);
    }

    return stopPulse;
  }, [totalUnread, startPulse, stopPulse]);

  // A returning tab always shows the settled state, never a half-finished pulse.
  useEffect(() => {
    const onVisibilityChange = () => {
      const visible = !document.hidden;
      isVisibleRef.current = visible;
      if (visible) {
        stopPulse();
        document.title = formatUnreadTitle(useMessengerStore.getState().totalUnread());
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [stopPulse]);

  // Leaving the app (logout or unmount) clears every unread indicator.
  useEffect(() => {
    return () => {
      stopPulse();
      document.title = BASE_TITLE;
      applyUnreadBadges(0);
    };
  }, [stopPulse]);
}
