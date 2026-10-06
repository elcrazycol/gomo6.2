import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ThreadCard } from "@/components/ThreadCard";
import { useLoadingBarStore } from "@/stores/loadingBarStore";
import { transitionEnterClass } from "@/lib/viewTransitions";
import { useTransitionStyle } from "@/hooks/useTransitionStyle";

interface ProfileThreadsTabProps {
  userId: string;
  /** The owner's total thread count, for the heading (the list itself is paged). */
  totalCount?: number;
  currentUser: { id: string } | null;
  currentUsername: string;
  currentUserColor: string;
}

/** Threads per page. */
const PAGE_SIZE = 20;
/** Start pulling the next page this far before the sentinel reaches the viewport. */
const PRELOAD_MARGIN_PX = 400;

type ThreadRow = Record<string, unknown> & {
  id: string;
  profiles: {
    username: string;
    display_name?: string | null;
    nickname_emoji_id?: string | null;
    is_anonymous: boolean;
    avatar_url?: string | null;
  } | null;
  post_count: number;
};

/**
 * The backend already embeds the author and the denormalized post_count, so a
 * raw thread only needs its flattened author fields folded into the `profiles`
 * shape ThreadCard expects.
 */
const normalizeThread = (raw: Record<string, unknown>): ThreadRow =>
  ({
    ...raw,
    profiles: {
      username: String(raw.username ?? ""),
      display_name: (raw.display_name as string | null) ?? null,
      nickname_emoji_id: (raw.nickname_emoji_id as string | null) ?? null,
      is_anonymous: Boolean(raw.is_anonymous),
      avatar_url: (raw.avatar_url as string | null) ?? null,
    },
    post_count: Number(raw.post_count ?? 0),
  }) as ThreadRow;

/**
 * «Записи» tab: the user's threads, paged and lazily extended.
 *
 * Only the first page is fetched on open; the next page is pulled when the
 * sentinel nears the viewport (IntersectionObserver), so a long profile never
 * renders (or fetches) everything at once. Each page costs two requests:
 * `/api/v1/threads` (author + post_count included) and the likes batch.
 * The header loading bar is the only loading indicator.
 *
 * Mount it with `key={userId}` so a profile switch starts from a clean page.
 */
export const ProfileThreadsTab = ({
  userId,
  totalCount,
  currentUser,
  currentUsername,
  currentUserColor,
}: ProfileThreadsTabProps) => {
  const { t } = useTranslation();
  const transitionStyle = useTransitionStyle();

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [likesMap, setLikesMap] = useState<Map<string, { count: number; isLiked: boolean }>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Latest request callback, so the observer never closes over a stale closure.
  const requestRef = useRef<() => void>(() => {});

  const loadPage = useCallback(
    async (reset: boolean) => {
      if (!userId || loadingRef.current) return;
      if (!reset && !hasMoreRef.current) return;

      loadingRef.current = true;
      const { begin, end } = useLoadingBarStore.getState();
      begin();
      const offset = reset ? 0 : offsetRef.current;

      try {
        const res = await fetch(
          `/api/v1/threads?user_id=eq.${userId}&order=created_at.desc&order=id.desc&limit=${PAGE_SIZE}&offset=${offset}`,
        );
        const json = await res.json();
        const rows: ThreadRow[] = ((json.data || []) as Record<string, unknown>[]).map(normalizeThread);

        setThreads((prev) => {
          if (reset) return rows;
          const seen = new Set(prev.map((thread) => thread.id));
          return [...prev, ...rows.filter((thread) => !seen.has(thread.id))];
        });
        offsetRef.current = offset + rows.length;

        const more = rows.length === PAGE_SIZE;
        hasMoreRef.current = more;
        setHasMore(more);

        // Likes for this page (best-effort — the cards render without them).
        const ids = rows.map((thread) => thread.id).filter(Boolean);
        if (ids.length > 0) {
          try {
            const likesRes = await fetch(
              `/api/rpc/get_thread_likes_batch?thread_ids=${ids.join(",")}&user_uuid=${currentUser?.id || ""}`,
            );
            const likesJson = await likesRes.json();
            if (Array.isArray(likesJson.data)) {
              setLikesMap((prev) => {
                const next = new Map(prev);
                for (const item of likesJson.data) {
                  next.set(item.thread_id, { count: item.count, isLiked: item.is_liked });
                }
                return next;
              });
            }
          } catch {
            /* ignore */
          }
        }
      } catch (error) {
        console.error("Error loading user threads:", error);
        toast.error(t("profile.threadsLoadError"));
        hasMoreRef.current = false;
        setHasMore(false);
      } finally {
        end();
        loadingRef.current = false;
        setLoaded(true);
        // If the sentinel is still in the trigger zone after an append (fast
        // scroll past the bottom), pull the next page right away.
        requestRef.current();
      }
    },
    [userId, currentUser?.id, t],
  );

  // First page on mount. The component is keyed by userId, so this runs once
  // per profile.
  useEffect(() => {
    hasMoreRef.current = true;
    loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ask for the next page only when the sentinel is within the preload margin.
  const request = useCallback(() => {
    if (!hasMoreRef.current || loadingRef.current) return;
    const el = sentinelRef.current;
    if (!el) return;
    const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
    if (el.getBoundingClientRect().top <= viewport + PRELOAD_MARGIN_PX) {
      loadPage(false);
    }
  }, [loadPage]);
  requestRef.current = request;

  useEffect(() => {
    if (!hasMore || !loaded) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) requestRef.current();
      },
      { rootMargin: `0px 0px ${PRELOAD_MARGIN_PX}px 0px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loaded]);

  if (!loaded) return null;

  const count = totalCount ?? threads.length;

  return (
    <div className={transitionEnterClass(transitionStyle)}>
      <h2 className="text-xl font-bold mb-4">
        {t("profile.threads")} ({count})
      </h2>

      {threads.length === 0 ? (
        <p className="text-muted-foreground">{t("profile.noThreads")}</p>
      ) : (
        <div className="space-y-4">
          {threads.map((thread) => {
            const likes = likesMap.get(thread.id);
            return (
              <ThreadCard
                key={thread.id}
                thread={thread as never}
                currentUserId={currentUser?.id || null}
                currentUsername={currentUsername}
                currentUserColor={currentUserColor}
                showPreview={true}
                initialLikesCount={likes?.count ?? 0}
                initialUserLiked={likes?.isLiked ?? false}
              />
            );
          })}
        </div>
      )}

      {/* Scroll sentinel — invisible; the observer watches it. */}
      {hasMore && <div ref={sentinelRef} className="h-px" aria-hidden="true" />}
    </div>
  );
};
