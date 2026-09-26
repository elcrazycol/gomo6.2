import { useEffect, useState } from "react";
import { getProfileCustomization, type ProfileCustomization } from "@/utils/profileCustomization";
import { PROFILE_CACHE_INVALIDATE_EVENT } from "@/utils/profileCacheEvents";

/**
 * A user's profile customization (nickname CSS, badge text/CSS), kept in sync
 * with edits made in the Profile Studio.
 *
 * `getProfileCustomization` is backed by a module-level cache that
 * `dispatchProfileCacheInvalidate()` clears — but a component that reads it once
 * in an effect never learns about that: the cache is cleared for the *next*
 * reader while this component keeps the value it already copied into state.
 * That is why a nickname colour changed in the studio only showed up after a
 * remount. Subscribing to the same event and re-reading closes the hole.
 *
 * The re-read also runs when the tab becomes visible again: the invalidate event
 * only fires in the editor's own browser, so viewers catch up when the cache
 * entry has expired (see CUSTOMIZATION_TTL) and something asks for it again.
 */
export function useProfileCustomization(
  userId: string | null | undefined,
  enabled = true,
): ProfileCustomization | null {
  const [customization, setCustomization] = useState<ProfileCustomization | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);

    window.addEventListener(PROFILE_CACHE_INVALIDATE_EVENT, bump);

    // A background tab receives no paint and no events; re-reading on the way
    // back in is the cheapest way to catch up.
    const onVisibilityChange = () => {
      if (!document.hidden) bump();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener(PROFILE_CACHE_INVALIDATE_EVENT, bump);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!userId || !enabled) {
      setCustomization(null);
      return;
    }

    let alive = true;
    getProfileCustomization(userId).then((value) => {
      if (alive) setCustomization(value);
    });

    return () => {
      alive = false;
    };
  }, [userId, enabled, version]);

  return customization;
}
