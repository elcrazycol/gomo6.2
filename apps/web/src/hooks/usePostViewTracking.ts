import { useEffect, useRef } from "react";

/**
 * Wall-post view tracking.
 *
 * A "view" is counted the moment a post card actually becomes visible in the
 * viewport (the user's eyes "saw" it). The server dedupes per unique visitor
 * (user id for authenticated callers, a persistent anonymous browser key for
 * guests), so this module only needs to dedupe *within one session* to avoid
 * re-firing for cards the user scrolls past several times.
 *
 * Views are batched: cards report into a module-level queue that flushes to
 * POST /api/rpc/record_wall_views after a short debounce (or when the batch
 * grows large), so a 20-post wall costs ONE request, not 20.
 */

const ANON_VIEWER_KEY_STORAGE = "gomo6_anon_viewer_key";
const FLUSH_DELAY_MS = 2000;
const BATCH_LIMIT = 25;

/** Post ids already counted in this session (module-level, across cards). */
const viewedPostIds = new Set<string>();
let pendingPostIds: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Persistent anonymous-browser id. Guests cannot be attributed to a person, so
 * the server dedupes their views by this key (one view per browser per post).
 */
export const getAnonymousViewerKey = (): string => {
  try {
    let key = window.localStorage.getItem(ANON_VIEWER_KEY_STORAGE);
    if (!key) {
      key = crypto.randomUUID();
      window.localStorage.setItem(ANON_VIEWER_KEY_STORAGE, key);
    }
    return key;
  } catch {
    return "";
  }
};

/** Sends the queued post ids to the backend (fire-and-forget, keepalive). */
export const flushWallViews = (): void => {
  flushTimer = null;
  if (pendingPostIds.length === 0) return;
  const ids = pendingPostIds;
  pendingPostIds = [];
  try {
    fetch("/api/rpc/record_wall_views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_ids: ids, viewer_key: getAnonymousViewerKey() }),
      keepalive: true,
    }).catch(() => {
      // Best-effort analytics — never surface errors to the user.
    });
  } catch {
    // ignore
  }
};

const scheduleFlush = (): void => {
  if (pendingPostIds.length >= BATCH_LIMIT) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushWallViews();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(flushWallViews, FLUSH_DELAY_MS);
};

/** Marks a post as viewed (session dedup) and queues it for the next flush. */
export const registerWallPostView = (postId: string): void => {
  if (!postId || viewedPostIds.has(postId)) return;
  viewedPostIds.add(postId);
  pendingPostIds.push(postId);
  scheduleFlush();
};

// Flush whatever is still queued when the tab goes away — otherwise a quick
// visit that ends before the debounce fires would never report its views.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushWallViews();
  });
}

/**
 * Attaches view tracking to one post card. Returns a ref to put on the card's
 * root element; the hook observes it and reports the post as viewed once the
 * card is at least ~a third visible.
 */
export const usePostViewTracking = (postId?: string | null, enabled = true) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled || !postId) return;
    if (viewedPostIds.has(postId)) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            registerWallPostView(postId);
            observer.disconnect();
            break;
          }
        }
      },
      // "Eyes saw it": the card must be substantially inside the viewport, not
      // just grazed at the edge while scrolling fast.
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [postId, enabled]);

  return ref;
};
