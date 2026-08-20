import { useState, useEffect, useCallback, useRef } from "react";
import { useProfileInvalidation } from "@/hooks/useProfileInvalidation";
import { FeedThreadCard, type FeedThread } from "@/components/FeedThreadCard";
import { FeedWallPostCard } from "@/components/FeedWallPostCard";
import { PentagramLoader } from "@/components/PentagramLoader";
import { ThreadFeedSkeleton } from "@/components/skeletons/ContentSkeletons";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { normalizeWallPostRecord, type WallPost } from "@/utils/wallNormalizers";
import { wsService, type WebSocketMessageType } from "@/services/websocket";

/** One unified feed item as returned by GET /api/v1/feed. */
interface FeedItem {
  item_type: "thread" | "wall_post";
  item_id: string;
  score: number;
  created_at: string;
  updated_at?: string | null;
  title?: string | null;
  content?: string | null;
  content_json?: unknown;
  image_url?: string | null;
  image_urls?: string[] | null;
  attachments?: unknown;
  tags?: Record<string, string> | null;
  post_count?: number | null;
  author_id?: string | null;
  author?: {
    username: string;
    display_name?: string | null;
    nickname_emoji_id?: string | null;
    is_anonymous: boolean;
    avatar_url?: string | null;
  } | null;
  board_id?: string | null;
  boards?: {
    slug: string;
    name: string;
    is_gomosub: boolean;
  } | null;
  wall_user_id?: string | null;
  likes_count: number;
  comments_count: number;
  reposts_count: number;
  liked_by_viewer: boolean;
  views_count: number;
}

interface ThreadFeedProps {
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor?: string;
  limit?: number;
}

const PULL_THRESHOLD = 60;

/**
 * Unified personalized feed (threads + wall posts).
 *
 * GET /api/v1/feed returns a reverse-chronological mix (with light
 * personalization + popularity fallback, see migration 104_feed_v2.sql) scored
 * per viewer. Pagination is keyset-based via a `before=<score>:<item_id>`
 * cursor, and pull-to-refresh / focus / websocket events fetch newer items via
 * `since=<RFC3339>`, surfaced as an X-style "N новых постов" pill.
 */
export const ThreadFeed = ({
  currentUserId,
  currentUsername,
  currentUserColor,
  limit = 20
}: ThreadFeedProps) => {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pendingNew, setPendingNew] = useState<FeedItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [galleryItems, setGalleryItems] = useState<LightboxItem[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // Latest-value refs so the long-lived websocket/observer/focus handlers never
  // close over stale state.
  const itemsRef = useRef<FeedItem[]>([]);
  const pendingRef = useRef<FeedItem[]>([]);
  const newestMsRef = useRef<number | null>(null);
  const loadingRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);

  const observerRef = useRef<IntersectionObserver>();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const nextLoadMoreAtRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const newCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createdMs = useCallback((it: FeedItem) => Date.parse(it.created_at), []);

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { pendingRef.current = pendingNew; }, [pendingNew]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { loadingMoreRef.current = loadingMore; }, [loadingMore]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => {
    newestMsRef.current = items.length ? Math.max(...items.map(createdMs)) : null;
  }, [items, createdMs]);

  const feedToThread = (item: FeedItem): FeedThread => ({
    id: item.item_id,
    title: item.title || "",
    content: item.content || "",
    content_json: item.content_json,
    image_url: item.image_url ?? null,
    image_urls: item.image_urls ?? null,
    attachments: item.attachments,
    created_at: item.created_at,
    updated_at: item.updated_at || item.created_at,
    user_id: item.author_id ?? null,
    board_id: item.board_id ?? "",
    post_count: item.post_count ?? 0,
    tags: item.tags ?? undefined,
    profiles: item.author ?? null,
    boards: item.boards ?? { slug: "b", name: "Доска" },
  });

  const feedToWallPost = (item: FeedItem): WallPost =>
    normalizeWallPostRecord({
      id: item.item_id,
      user_id: item.wall_user_id,
      author_id: item.author_id,
      title: item.title,
      content: item.content,
      content_json: item.content_json,
      image_url: item.image_url,
      attachments: item.attachments,
      created_at: item.created_at,
      updated_at: item.updated_at,
      likes_count: item.likes_count,
      comments_count: item.comments_count,
      reposts_count: item.reposts_count,
      liked_by_viewer: item.liked_by_viewer,
      views_count: item.views_count,
      author: item.author,
    } as unknown as Record<string, unknown>);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/v1/feed?limit=${limit + 1}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      let feedItems = (result.data || []) as FeedItem[];

      const hasMoreData = feedItems.length > limit;
      if (hasMoreData) {
        feedItems = feedItems.slice(0, limit);
      }

      setItems(feedItems);
      setHasMore(hasMoreData);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      console.error("Error loading feed:", error);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;

    const current = itemsRef.current;
    const last = current[current.length - 1];
    if (!last) return;

    setLoadingMore(true);
    try {
      const cursor = `${last.score}:${last.item_id}`;
      const response = await fetch(`/api/v1/feed?limit=${limit + 1}&before=${encodeURIComponent(cursor)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      let feedItems = (result.data || []) as FeedItem[];

      const hasMoreData = feedItems.length > limit;
      if (hasMoreData) {
        feedItems = feedItems.slice(0, limit);
      }
      if (feedItems.length === 0) {
        setHasMore(false);
        return;
      }

      setItems(prev => {
        const seen = new Set(prev.map(p => p.item_id));
        const added = feedItems.filter(f => !seen.has(f.item_id));
        return [...prev, ...added];
      });
      setHasMore(hasMoreData);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      nextLoadMoreAtRef.current = Date.now() + 15 * 1000;
      console.error("Error loading more feed:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [limit]);

  // Fetch items newer than the newest item we already hold (the pull-to-refresh
  // / focus / websocket "new posts" check). Results are parked in `pendingNew`
  // and shown as an X-style pill instead of jumping the scroll position.
  const checkForNew = useCallback(async () => {
    const newest = newestMsRef.current;
    if (newest == null) return;
    const since = new Date(newest).toISOString();
    try {
      const response = await fetch(`/api/v1/feed?limit=50&since=${encodeURIComponent(since)}`);
      if (!response.ok) return;
      const result = await response.json();
      const fresh = ((result.data || []) as FeedItem[]).filter(it => createdMs(it) > newest);
      if (fresh.length === 0) return;
      setPendingNew(prev => {
        const seen = new Set(prev.map(p => p.item_id));
        return [...prev, ...fresh.filter(f => !seen.has(f.item_id))];
      });
    } catch {
      // Background poll — network errors here are non-fatal and stay silent.
    }
  }, [createdMs]);

  const showNew = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.length === 0) return;

    setItems(prev => {
      const seen = new Set(prev.map(p => p.item_id));
      const added = pending.filter(p => !seen.has(p.item_id));
      return [...added, ...prev];
    });
    setPendingNew([]);
  }, []);

  useEffect(() => {
    loadInitial();
    return () => { abortRef.current?.abort(); };
  }, [loadInitial]);

  // Reload when the current user edits their profile: the nickname emoji is
  // embedded in the feed payload and would otherwise stay stale.
  useProfileInvalidation(() => { loadInitial(); });

  // Debounced "check for new" shared by websocket events (new_thread/new_post
  // reach the global feed room) so a burst of events triggers one poll.
  const scheduleNewCheck = useCallback(() => {
    if (newCheckTimerRef.current) clearTimeout(newCheckTimerRef.current);
    newCheckTimerRef.current = setTimeout(() => { checkForNew(); }, 3000);
  }, [checkForNew]);

  useEffect(() => {
    const events: WebSocketMessageType[] = ["new_post", "new_thread"];
    const unsubs = events.map(evt => wsService.on(evt, () => { scheduleNewCheck(); }));
    return () => { unsubs.forEach(u => u()); };
  }, [scheduleNewCheck]);

  useEffect(() => {
    const onFocus = () => { checkForNew(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkForNew();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkForNew]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasMore &&
          !loadingMore &&
          !loading &&
          Date.now() >= nextLoadMoreAtRef.current
        ) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, loadingMore, loading, loadMore]);

  // ── Pull-to-refresh (touch, from the top of the page) ─────────────────────
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartYRef.current == null) return;
    const delta = e.touches[0].clientY - touchStartYRef.current;
    setPullDistance(delta > 0 && window.scrollY <= 0 ? Math.min(delta, 90) : 0);
  };

  const onTouchEnd = async () => {
    if (touchStartYRef.current == null) return;
    const shouldRefresh = pullDistance >= PULL_THRESHOLD;
    touchStartYRef.current = null;
    setPullDistance(0);
    if (shouldRefresh) {
      setRefreshing(true);
      await checkForNew();
      setRefreshing(false);
    }
  };

  if (loading) {
    return <ThreadFeedSkeleton count={limit > 5 ? 5 : limit} />;
  }

  return (
    <>
      <div
        className="space-y-4"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {(refreshing || pullDistance > 0) && (
          <div
            className="flex items-center justify-center py-2 text-sm text-muted-foreground"
            style={{ transform: `translateY(${pullDistance / 3}px)` }}
          >
            <PentagramLoader size="sm" />
            <span className="ml-2">
              {refreshing ? "Обновляем…" : "Потяни, чтобы обновить"}
            </span>
          </div>
        )}

        {pendingNew.length > 0 && (
          <button
            type="button"
            onClick={showNew}
            className="sticky top-16 z-10 mx-auto flex w-fit items-center gap-2 rounded-full border border-primary/40 bg-primary/95 px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg backdrop-blur transition hover:bg-primary"
          >
            Показать {pendingNew.length} новых {pendingNew.length === 1 ? "пост" : "постов"}
          </button>
        )}

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 py-12 text-center">
            <p className="text-lg font-medium">В ленте пока пусто</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {currentUserId
                ? "Лайкай треды и заходи в g-сабы — рекомендации подстроятся под тебя"
                : "Здесь появятся свежие треды и записи со стен"}
            </p>
          </div>
        ) : (
          items.map((item) => {
            if (item.item_type === "thread") {
              const thread = feedToThread(item);
              return (
                <FeedThreadCard
                  key={`thread-${thread.id}`}
                  thread={thread}
                  currentUserId={currentUserId}
                  currentUsername={currentUsername}
                  currentUserColor={currentUserColor}
                  initialLikesCount={item.likes_count}
                  initialUserLiked={item.liked_by_viewer}
                  onImageClick={(items, idx) => {
                    setGalleryItems(items);
                    setGalleryIndex(idx);
                  }}
                />
              );
            }
            const wallPost = feedToWallPost(item);
            return (
              <FeedWallPostCard
                key={`wall-${wallPost.id}`}
                post={wallPost}
                currentUserId={currentUserId}
                currentUsername={currentUsername}
                currentUserColor={currentUserColor}
                onImageClick={(items, idx) => {
                  setGalleryItems(items);
                  setGalleryIndex(idx);
                }}
              />
            );
          })
        )}

        <div ref={loadMoreRef} className="py-4">
          {loadingMore && (
            <div className="flex justify-center">
              <PentagramLoader size="md" />
            </div>
          )}
          {!hasMore && items.length > 0 && (
            <div className="text-center text-muted-foreground py-4">
              Больше контента нет
            </div>
          )}
        </div>
      </div>

      {!!galleryItems && (
        <Lightbox
          items={galleryItems}
          initialIndex={galleryIndex}
          onClose={() => setGalleryItems(null)}
        />
      )}
    </>
  );
};
