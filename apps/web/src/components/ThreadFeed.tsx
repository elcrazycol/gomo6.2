import { useState, useEffect, useCallback, useRef } from "react";
import { useProfileInvalidation } from "@/hooks/useProfileInvalidation";
import { FeedThreadCard, type FeedThread } from "@/components/FeedThreadCard";
import { FeedWallPostCard } from "@/components/FeedWallPostCard";
import { PentagramLoader } from "@/components/PentagramLoader";
import { ThreadFeedSkeleton } from "@/components/skeletons/ContentSkeletons";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { normalizeWallPostRecord, type WallPost } from "@/utils/wallNormalizers";

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

/**
 * Unified personalized feed (threads + wall posts).
 *
 * GET /api/v1/feed returns a scored, per-viewer mix produced by the
 * get_user_feed() SQL function. Unlike the old implementation it needs no
 * separate recommendations RPC (that endpoint never existed — the client
 * silently fell back to "latest threads" for everyone) and no per-card like
 * fetches: like counts and viewer state are embedded in each item.
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
  const [offset, setOffset] = useState(0);
  const [galleryItems, setGalleryItems] = useState<LightboxItem[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const observerRef = useRef<IntersectionObserver>();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Backoff for the infinite-scroll sentinel: on API errors the observer must
  // not hammer the endpoint (same behavior as the old feed).
  const nextLoadMoreAtRef = useRef(0);

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

  const loadFeed = useCallback(async (isLoadMore = false) => {
    try {
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Offset pagination over a score that decays with age: the exact order
      // can drift slightly between refreshes (rare dupes/skips on fast reload).
      // Accepted MVP trade-off; a keyset cursor over a frozen score snapshot
      // would remove it later.
      const nextOffset = isLoadMore ? offset : 0;
      const url = `/api/v1/feed?limit=${limit + 1}&offset=${nextOffset}`;

      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      let feedItems = (result.data || []) as FeedItem[];

      const hasMoreData = feedItems.length > limit;
      if (hasMoreData) {
        feedItems = feedItems.slice(0, limit);
      }

      if (isLoadMore) {
        setItems(prev => [...prev, ...feedItems]);
      } else {
        setItems(feedItems);
      }
      setOffset(nextOffset + feedItems.length);
      setHasMore(hasMoreData);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      nextLoadMoreAtRef.current = Date.now() + 15 * 1000;
      console.error("Error in loadFeed:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [offset, limit]);

  useEffect(() => {
    loadFeed();
    return () => { abortRef.current?.abort(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload when the current user edits their profile: the nickname emoji is
  // embedded in the feed payload and would otherwise stay stale.
  useProfileInvalidation(() => { loadFeed(); });

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
          loadFeed(true);
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
  }, [hasMore, loadingMore, loading, loadFeed]);

  if (loading) {
    return <ThreadFeedSkeleton count={limit > 5 ? 5 : limit} />;
  }

  return (
    <>
      <div className="space-y-4">
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
