import { useCallback, useEffect, useMemo, useState } from "react";

import { apiClient } from "@/integrations/api/client";
import { FeedThreadCard, type FeedThread } from "@/components/FeedThreadCard";
import { FeedWallPostCard } from "@/components/FeedWallPostCard";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { PentagramLoader } from "@/components/PentagramLoader";
import { ThreadFeedSkeleton } from "@/components/skeletons/ContentSkeletons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLoadingBarStore } from "@/stores/loadingBarStore";
import { normalizeWallPostRecord, type WallPost } from "@/utils/wallNormalizers";

const PAGE_SIZE = 30;

/** One row from GET /api/v1/history (the unified-feed wire shape + viewed_at). */
interface HistoryItem {
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
  viewed_at?: string;
}

const toFeedThread = (item: HistoryItem): FeedThread => ({
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

const toWallPost = (item: HistoryItem): WallPost =>
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

interface HistoryViewProps {
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor?: string;
  onReady?: () => void;
}

/**
 * «История» — the threads and wall posts the viewer opened, newest first, with
 * a "clear history" action. Items render with the shared feed cards.
 */
export const HistoryView = ({
  currentUserId,
  currentUsername,
  currentUserColor,
  onReady,
}: HistoryViewProps) => {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [galleryItems, setGalleryItems] = useState<LightboxItem[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  useEffect(() => {
    if (!currentUserId) {
      setItems([]);
      return;
    }
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
        const resp = await apiClient.request<HistoryItem[]>(`/api/v1/history?limit=${limit}`);
        const rows = (resp.data || []) as HistoryItem[];
        if (cancelled) return;
        setItems(rows);
        setHasMore(rows.length === limit);
      } catch (error) {
        if (cancelled) return;
        console.error("Error loading history:", error);
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

  // Let the parent reveal this view as soon as the first page is on screen.
  useEffect(() => {
    if (items && onReady) onReady();
  }, [items, onReady]);

  const showMore = () => {
    setLoadingMore(true);
    setLimit((prev) => prev + PAGE_SIZE);
  };

  const clearHistory = useCallback(async () => {
    setClearing(true);
    try {
      await apiClient.request("/api/v1/history", { method: "DELETE" });
      setItems([]);
      setHasMore(false);
      setConfirmOpen(false);
    } catch (error) {
      console.error("Error clearing history:", error);
    } finally {
      setClearing(false);
    }
  }, []);

  const body = useMemo(() => {
    if (!items) return null;
    return items.map((item) =>
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
  }, [items, currentUserId, currentUsername, currentUserColor]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold leading-tight sm:text-2xl">История</h2>
        {currentUserId && items && items.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="shrink-0 rounded-full border border-border/70 px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
          >
            Очистить историю
          </button>
        )}
      </div>

      {!items ? (
        <ThreadFeedSkeleton count={5} />
      ) : items.length === 0 ? (
        <div className="rounded-[var(--card-radius)] border border-dashed border-border/70 bg-muted/20 py-12 text-center">
          <p className="text-lg font-medium">
            {currentUserId ? "История пуста" : "Войди, чтобы видеть историю"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {currentUserId
              ? "Открытые темы и посты будут появляться здесь"
              : "История просмотров доступна только авторизованным"}
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

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Очистить историю?</DialogTitle>
            <DialogDescription>
              Все просмотренные записи исчезнут из истории. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={clearHistory} disabled={clearing}>
              {clearing ? <PentagramLoader size="sm" /> : "Очистить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
