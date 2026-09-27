import { useEffect, useMemo, useState } from "react";

import { apiClient } from "@/integrations/api/client";
import { FeedThreadCard, type FeedThread } from "@/components/FeedThreadCard";
import { FeedWallPostCard } from "@/components/FeedWallPostCard";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { PentagramLoader } from "@/components/PentagramLoader";
import { ThreadFeedSkeleton } from "@/components/skeletons/ContentSkeletons";
import { favoriteKey, useFavoritesStore } from "@/stores/favoritesStore";
import { useLoadingBarStore } from "@/stores/loadingBarStore";
import { normalizeWallPostRecord, type WallPost } from "@/utils/wallNormalizers";

const PAGE_SIZE = 30;

/** One row from GET /api/v1/favorites (the unified-feed wire shape + saved_at). */
interface FavoriteItem {
  item_type: "thread" | "wall_post";
  item_id: string;
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
  author?: FeedThread["profiles"];
  board_id?: string | null;
  boards?: FeedThread["boards"] | null;
  section?: FeedThread["section"];
  subsection?: FeedThread["subsection"];
  wall_user_id?: string | null;
  likes_count: number;
  comments_count: number;
  reposts_count: number;
  liked_by_viewer: boolean;
  views_count: number;
  saved_at?: string;
}

const toFeedThread = (item: FavoriteItem): FeedThread => ({
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
  boards: item.boards ?? { slug: "", name: "", is_gomosub: false },
  section: item.section ?? null,
  subsection: item.subsection ?? null,
});

const toWallPost = (item: FavoriteItem): WallPost =>
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

interface FavoritesViewProps {
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor?: string;
  onReady?: () => void;
}

/**
 * «Избранное» — bookmarked threads and wall posts. The list is filtered by the
 * favorites store, so removing a bookmark (via the card's corner button) drops
 * the card immediately.
 */
export const FavoritesView = ({
  currentUserId,
  currentUsername,
  currentUserColor,
  onReady,
}: FavoritesViewProps) => {
  const [items, setItems] = useState<FavoriteItem[] | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [galleryItems, setGalleryItems] = useState<LightboxItem[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const favoriteIds = useFavoritesStore((state) => state.ids);
  const favoritesLoaded = useFavoritesStore((state) => state.loaded);

  useEffect(() => {
    if (!currentUserId) {
      setItems([]);
      return;
    }
    // Make sure the store is populated so the filter below is meaningful.
    void useFavoritesStore.getState().load();

    let cancelled = false;
    let finished = false;
    const { begin, end } = useLoadingBarStore.getState();
    const finish = () => {
      if (finished) return;
      finished = true;
      end();
    };
    begin();

    (async () => {
      try {
        const resp = await apiClient.request<FavoriteItem[]>(`/api/v1/favorites?limit=${limit}`);
        const rows = (resp.data || []) as FavoriteItem[];
        if (cancelled) return;
        setItems(rows);
        setHasMore(rows.length === limit);
      } catch (error) {
        if (cancelled) return;
        console.error("Error loading favorites:", error);
        setItems((prev) => prev ?? []);
        setHasMore(false);
      } finally {
        finish();
        if (!cancelled) setLoadingMore(false);
      }
    })();

    return () => {
      cancelled = true;
      finish();
    };
  }, [currentUserId, limit]);

  useEffect(() => {
    if (items && onReady) onReady();
  }, [items, onReady]);

  const showMore = () => {
    setLoadingMore(true);
    setLimit((prev) => prev + PAGE_SIZE);
  };

  // Drop cards whose bookmark was just removed (store updates optimistically).
  const visibleItems = useMemo(() => {
    if (!items) return null;
    if (!favoritesLoaded) return items;
    return items.filter((item) => favoriteIds.has(favoriteKey(item.item_type, item.item_id)));
  }, [items, favoritesLoaded, favoriteIds]);

  const body = useMemo(() => {
    if (!visibleItems) return null;
    return visibleItems.map((item) =>
      item.item_type === "thread" ? (
        <FeedThreadCard
          key={`thread-${item.item_id}`}
          thread={toFeedThread(item)}
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          currentUserColor={currentUserColor}
          initialLikesCount={item.likes_count}
          initialUserLiked={item.liked_by_viewer}
          onImageClick={(items2, idx) => {
            setGalleryItems(items2);
            setGalleryIndex(idx);
          }}
        />
      ) : (
        <FeedWallPostCard
          key={`wall-${item.item_id}`}
          post={toWallPost(item)}
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          currentUserColor={currentUserColor}
          onImageClick={(items2, idx) => {
            setGalleryItems(items2);
            setGalleryIndex(idx);
          }}
        />
      ),
    );
  }, [visibleItems, currentUserId, currentUsername, currentUserColor]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold leading-tight sm:text-2xl">Избранное</h2>

      {!items ? (
        <ThreadFeedSkeleton count={5} />
      ) : !visibleItems || visibleItems.length === 0 ? (
        <div className="rounded-[var(--card-radius)] border border-dashed border-border/70 bg-muted/20 py-12 text-center">
          <p className="text-lg font-medium">
            {currentUserId ? "В избранном пусто" : "Войди, чтобы видеть избранное"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {currentUserId
              ? "Наведи на запись и нажми закладку в углу карточки"
              : "Избранное доступно только авторизованным"}
          </p>
        </div>
      ) : (
        <div className="space-y-4 animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none">
          {body}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={showMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface px-4 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/60 disabled:opacity-60"
              >
                {loadingMore ? <PentagramLoader size="sm" /> : "Показать ещё"}
              </button>
            </div>
          )}
        </div>
      )}

      {galleryItems && (
        <Lightbox
          items={galleryItems}
          initialIndex={galleryIndex}
          onClose={() => setGalleryItems(null)}
        />
      )}
    </div>
  );
};
