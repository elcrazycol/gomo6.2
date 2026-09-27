import { useEffect, useMemo, useState } from "react";

import { api } from "@/integrations/api/compat";
import { FeedThreadCard, type FeedThread } from "@/components/FeedThreadCard";
import { FeedWallPostCard } from "@/components/FeedWallPostCard";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { PentagramLoader } from "@/components/PentagramLoader";
import { ThreadFeedSkeleton } from "@/components/skeletons/ContentSkeletons";
import { useLoadingBarStore } from "@/stores/loadingBarStore";
import {
  normalizeWallPostRecord,
  type WallPost,
} from "@/utils/wallNormalizers";
import { fetchThreadLikesBatch, toFeedThread, type ThreadApiRow } from "@/utils/threadFeedItem";

const PAGE_SIZE = 50;

type MergedItem =
  | { kind: "thread"; createdAt: string; thread: FeedThread }
  | { kind: "wall"; createdAt: string; post: WallPost };

interface MyPostsProps {
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor?: string;
  onReady?: () => void;
}

/**
 * "Мои записи" — every record the viewer authored: topics (global + g-sub
 * threads) and wall posts on their own wall and on anyone else's. Threads and
 * wall posts come from two endpoints and are merged into one reverse-
 * chronological list rendered with the shared feed cards.
 */
export const MyPosts = ({
  currentUserId,
  currentUsername,
  currentUserColor,
  onReady,
}: MyPostsProps) => {
  const [items, setItems] = useState<MergedItem[] | null>(null);
  const [likes, setLikes] = useState<Map<string, { count: number; isLiked: boolean }>>(new Map());
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
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
        const [threadsRes, wallRes] = await Promise.all([
          fetch(
            `/api/v1/threads?user_id=eq.${currentUserId}&order=created_at.desc&limit=${limit}`,
          ),
          api
            .from("profile_wall_posts")
            .select("*")
            .eq("author_id", currentUserId)
            .order("created_at", { ascending: false })
            .limit(limit),
        ]);

        const threadsJson = threadsRes.ok ? await threadsRes.json() : { data: [] };
        const threadRows = (threadsJson.data || []) as ThreadApiRow[];
        const wallRows = ((wallRes as { data?: Record<string, unknown>[] | null }).data || []);

        const merged: MergedItem[] = [
          ...threadRows.map<MergedItem>((row) => {
            const thread = toFeedThread(row);
            return { kind: "thread", createdAt: thread.created_at, thread };
          }),
          ...wallRows.map<MergedItem>((row) => {
            const post = normalizeWallPostRecord(row, currentUsername);
            return { kind: "wall", createdAt: post.created_at, post };
          }),
        ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

        if (cancelled) return;
        setItems(merged);
        setHasMore(threadRows.length === limit || wallRows.length === limit);

        const threadLikes = await fetchThreadLikesBatch(threadRows.map((row) => row.id), currentUserId);
        if (cancelled) return;
        setLikes(threadLikes);
      } catch (error) {
        if (cancelled) return;
        console.error("Error loading my posts:", error);
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
  }, [currentUserId, limit, currentUsername]);

  // Let the parent reveal this view as soon as the first page is on screen.
  useEffect(() => {
    if (items && onReady) onReady();
  }, [items, onReady]);

  const showMore = () => {
    setLoadingMore(true);
    setLimit((prev) => prev + PAGE_SIZE);
  };

  const body = useMemo(() => {
    if (!items) return null;
    return items.map((item) => {
      if (item.kind === "thread") {
        const like = likes.get(item.thread.id);
        return (
          <FeedThreadCard
            key={`thread-${item.thread.id}`}
            thread={item.thread}
            currentUserId={currentUserId}
            currentUsername={currentUsername}
            currentUserColor={currentUserColor}
            initialLikesCount={like?.count ?? 0}
            initialUserLiked={like?.isLiked ?? false}
            onImageClick={(items2, idx) => {
              setGalleryItems(items2);
              setGalleryIndex(idx);
            }}
          />
        );
      }
      return (
        <FeedWallPostCard
          key={`wall-${item.post.id}`}
          post={item.post}
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          currentUserColor={currentUserColor}
          onImageClick={(items2, idx) => {
            setGalleryItems(items2);
            setGalleryIndex(idx);
          }}
        />
      );
    });
  }, [items, likes, currentUserId, currentUsername, currentUserColor]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold leading-tight sm:text-2xl">Мои записи</h2>

      {!items ? (
        <ThreadFeedSkeleton count={5} />
      ) : items.length === 0 ? (
        <div className="rounded-[var(--card-radius)] border border-dashed border-border/70 bg-muted/20 py-12 text-center">
          <p className="text-lg font-medium">Пока нет записей</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Создай тему или оставь пост на стене — всё появится здесь
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
