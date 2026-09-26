import { useEffect } from "react";
import { wsService } from "@/services/websocket";
import { dispatchProfileCacheInvalidate } from "@/utils/profileCustomization";

/**
 * Bridges the server's "profile_updated" broadcast into the local
 * `profile-cache:invalidate` event.
 *
 * The invalidate event is dispatched by whichever client performs a profile
 * edit, so it only ever reached that person's own browser — every other viewer
 * kept rendering the nickname, avatar and badge they had already cached. The
 * server now broadcasts the change (see Hub.PublishProfileUpdated), and
 * re-emitting it here means all the existing listeners do the right thing
 * without knowing where the event came from: the customization cache,
 * ProfileCacheContext, currentUserMeta, the API query cache, the feed/thread
 * query keys invalidated in AppLayout, and every mounted useProfileCustomization.
 */
export function useProfileRealtimeInvalidation(): void {
  useEffect(
    () =>
      wsService.on("profile_updated", () => {
        dispatchProfileCacheInvalidate();
      }),
    [],
  );

  // Realtime has to actually be alive to deliver those events, and a dead socket
  // is silent: nothing retries once `disconnect()` has run (auth:expired) or once
  // the backoff gives up, so a viewer could sit on a stale nickname forever while
  // believing the connection was fine. Repair on the events that mean "the user
  // is back": tab became visible, window focused, network came back.
  useEffect(() => {
    const recover = () => {
      if (wsService.connected) return; // live socket: events arrived as they happened
      // We may have missed profile updates while the socket was down, and a
      // cached nickname never expires on its own in the meantime.
      dispatchProfileCacheInvalidate();
      wsService.subscribeToFeed();
      wsService.ensureConnected();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") recover();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
    };
  }, []);
}
