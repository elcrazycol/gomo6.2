import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion, type Variants } from "motion/react";

import { api } from "@/integrations/api/compat";
import { FeedThreadCard, type FeedThread } from "@/components/FeedThreadCard";
import { FeedWallPostCard } from "@/components/FeedWallPostCard";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { QuietLoading } from "@/components/QuietLoading";
import { useLoadingBarStore } from "@/stores/loadingBarStore";
import { CASCADE_VARIANTS, morphOrigin, morphTransition, morphVariants } from "@/lib/motion";
import { normalizeWallPostRecord, type WallPost } from "@/utils/wallNormalizers";
import { fetchThreadLikesBatch, toFeedThread, type ThreadApiRow } from "@/utils/threadFeedItem";

/** Items per source per fetch. */
const PAGE_SIZE = 20;
/** Pull the next page this far before the sentinel reaches the viewport. */
const PRELOAD_MARGIN_PX = 600;

const CARD_ITEM: Variants = morphVariants(0.94, 0);

// Same select as ProfileWall so a card renders identically in both places.
const WALL_POST_SELECT = `
  id,
  user_id,
  author_id,
  title,
  content,
  content_json,
  image_url,
  attachments,
  repost_of_post_id,
  created_at,
  updated_at,
  is_pinned,
  pinned_order,
  author:profiles!author_id (
    username,
    is_anonymous,
    avatar_url
  )
`;

type MergedItem =
  | { kind: "thread"; createdAt: string; thread: FeedThread }
  | { kind: "wall"; createdAt: string; post: WallPost };

interface ProfileAllTabProps {
  /** The profile owner whose content is shown. */
  profileUserId: string;
  /** The owner's username — fallback author label for wall posts. */
  profileUsername: string;
  /** Include the owner's threads (already gated by the page's privacy rules). */
  includeThreads: boolean;
  /** Include posts left on the owner's wall (already gated by privacy). */
  includeWall: boolean;
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor: string;
}

/**
 * «Всё» tab: one reverse-chronological stream of everything the profile owner
 * produced — their threads (global topics + g-sub posts) and the posts on their
 * wall. It reuses the unified-feed cards so each item looks exactly like it does
 * on the feed/wall, and pulls the next page with an IntersectionObserver so a
 * long profile never loads (or renders) everything at once.
 *
 * Mount it with `key={userId}` so switching profiles starts from a clean page.
 */
export const ProfileAllTab = ({
  profileUserId,
  profileUsername,
  includeThreads,
  includeWall,
  currentUserId,
  currentUsername,
  currentUserColor,
}: ProfileAllTabProps) => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const cardTransition = morphTransition(reduceMotion);

  const [items, setItems] = useState<MergedItem[] | null>(null);
  const [likes, setLikes] = useState<Map<string, { count: number; isLiked: boolean }>>(new Map());
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [gallery, setGallery] = useState<{ items: LightboxItem[]; index: number } | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(false);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  // Append-only pagination: each page fetches the next PAGE_SIZE slice with an
  // offset instead of refetching the whole window. Long profiles no longer pay
  // quadratic fetch + full-list rebuild on every scroll step.
  useEffect(() => {
    setItems(null);
    setPage(0);
    setHasMore(false);
    setLikes(new Map());
  }, [profileUserId, includeThreads, includeWall]);

  useEffect(() => {
    if (!profileUserId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    loadingRef.current = true;
    const { begin, end } = useLoadingBarStore.getState();
    if (page === 0) begin();

    (async () => {
      try {
        const offset = page * PAGE_SIZE;
        const threadsReq: Promise<{ data?: ThreadApiRow[] }> = includeThreads
          ? fetch(
              `/api/v1/threads?user_id=eq.${profileUserId}&order=created_at.desc&order=id.desc&limit=${PAGE_SIZE}&offset=${offset}`,
            ).then((r) => (r.ok ? r.json() : { data: [] }))
          : Promise.resolve({ data: [] });

        const wallReq: Promise<{ data?: Record<string, unknown>[] | null }> = includeWall
          ? (api
              .from("profile_wall_posts")
              .select(WALL_POST_SELECT)
              .eq("user_id", profileUserId)
              .order("created_at", { ascending: false })
              .range(offset, offset + PAGE_SIZE - 1) as unknown as Promise<{ data?: Record<string, unknown>[] | null }>)
          : Promise.resolve({ data: [] });

        const [threadsRes, wallRes] = await Promise.all([threadsReq, wallReq]);
        if (cancelled) return;

        const threadRows = (threadsRes.data || []) as ThreadApiRow[];
        const wallRows = (wallRes.data || []) as Record<string, unknown>[];

        const merged: MergedItem[] = [
          ...threadRows.map<MergedItem>((row) => {
            const thread = toFeedThread(row);
            return { kind: "thread", createdAt: thread.created_at, thread };
          }),
          ...wallRows.map<MergedItem>((row) => {
            const post = normalizeWallPostRecord(row, profileUsername);
            return { kind: "wall", createdAt: post.created_at, post };
          }),
        ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

        const keyOf = (m: MergedItem) => (m.kind === "thread" ? `thread-${m.thread.id}` : `wall-${m.post.id}`);
        if (page === 0) {
          setItems(merged);
        } else {
          setItems((prev) => {
            if (!prev) return merged;
            const seen = new Set(prev.map(keyOf));
            const fresh = merged.filter((m) => !seen.has(keyOf(m)));
            return [...prev, ...fresh].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
          });
        }
        // A source has more only while it filled its whole page.
        setHasMore(
          (includeThreads && threadRows.length === PAGE_SIZE) ||
            (includeWall && wallRows.length === PAGE_SIZE),
        );

        const threadLikes = await fetchThreadLikesBatch(
          threadRows.map((row) => row.id),
          currentUserId,
        );
        if (cancelled) return;
        setLikes((prev) => new Map([...prev, ...threadLikes]));
      } catch (error) {
        if (cancelled) return;
        console.error("Error loading profile content:", error);
        setItems((prev) => prev ?? []);
        setHasMore(false);
      } finally {
        if (!cancelled) {
          loadingRef.current = false;
          setLoadingMore(false);
        }
        if (page === 0) end();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profileUserId, profileUsername, includeThreads, includeWall, currentUserId, page]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMoreRef.current) return;
    setLoadingMore(true);
    setPage((prev) => prev + 1);
  }, []);

  // Next page when the sentinel nears the viewport.
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: `0px 0px ${PRELOAD_MARGIN_PX}px 0px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const openGallery = useCallback((galleryItems: LightboxItem[], index: number) => {
    setGallery({ items: galleryItems, index });
  }, []);

  const body = useMemo(() => {
    if (!items) return null;
    return items.map((item) => {
      const key = item.kind === "thread" ? `thread-${item.thread.id}` : `wall-${item.post.id}`;
      const card =
        item.kind === "thread" ? (
          <FeedThreadCard
            thread={item.thread}
            currentUserId={currentUserId}
            currentUsername={currentUsername}
            currentUserColor={currentUserColor}
            initialLikesCount={likes.get(item.thread.id)?.count ?? 0}
            initialUserLiked={likes.get(item.thread.id)?.isLiked ?? false}
            onImageClick={openGallery}
          />
        ) : (
          <FeedWallPostCard
            post={item.post}
            currentUserId={currentUserId}
            currentUsername={currentUsername}
            currentUserColor={currentUserColor}
            onImageClick={openGallery}
          />
        );
      return (
        <motion.div
          key={key}
          variants={CARD_ITEM}
          transition={cardTransition}
          style={morphOrigin({ y: 0 })}
        >
          {card}
        </motion.div>
      );
    });
  }, [items, likes, currentUserId, currentUsername, currentUserColor, openGallery, cardTransition]);

  return (
    <div>
      {!items ? (
        <QuietLoading />
      ) : items.length === 0 ? (
        <div className="rounded-[var(--card-radius)] border border-dashed border-border/70 bg-muted/20 py-12 text-center">
          <p className="text-lg font-medium">{t("profile.allContentEmpty")}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("profile.allContentEmptyHint")}
          </p>
        </div>
      ) : (
        <motion.div
          initial={reduceMotion ? false : "hidden"}
          animate="show"
      variants={CASCADE_VARIANTS}
          className="space-y-4"
        >
          {body}
          {hasMore && <div ref={sentinelRef} className="h-px" aria-hidden="true" />}
          {loadingMore && (
            <div className="flex justify-center py-2">
              <QuietLoading className="min-h-0" />
            </div>
          )}
        </motion.div>
      )}

      {gallery && (
        <Lightbox
          items={gallery.items}
          initialIndex={gallery.index}
          onClose={() => setGallery(null)}
        />
      )}
    </div>
  );
};
