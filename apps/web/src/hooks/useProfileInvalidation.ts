import { useEffect, useRef } from "react";

const INVALIDATE_EVENT = "profile-cache:invalidate";
// Trailing debounce: a profile edit can fire the event several times in a row
// (e.g. set then remove a nickname emoji), and each fire used to trigger a
// full feed reload. Coalescing rapid sequential edits into one reload keeps
// bursts cheap.
const DEBOUNCE_MS = 300;

/**
 * Runs `onInvalidate` (with a trailing 300ms debounce) whenever the app
 * broadcasts `profile-cache:invalidate` — i.e. the current user edited their
 * profile (avatar/name/nickname emoji/customization). Feeds that embed the
 * profile data (nickname emoji in thread/post payloads) must reload, otherwise
 * they show stale data until the next navigation.
 */
export function useProfileInvalidation(onInvalidate: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cbRef = useRef(onInvalidate);
  cbRef.current = onInvalidate;

  useEffect(() => {
    const handler = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => cbRef.current(), DEBOUNCE_MS);
    };
    window.addEventListener(INVALIDATE_EVENT, handler);
    return () => {
      window.removeEventListener(INVALIDATE_EVENT, handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
