import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/integrations/api/compat";
import { ThreadCard } from "@/components/ThreadCard";
import { PentagramLoader } from "@/components/PentagramLoader";

interface Thread {
  id: string;
  title: string;
  content: string;
  image_url: string | null;
  image_urls?: string[] | null;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  board_id: string;
  post_count: number;
  profiles: {
    username: string;
    is_anonymous: boolean;
    avatar_url?: string | null;
  } | null;
  boards: {
    slug: string;
    name: string;
    is_gomosub?: boolean | null;
  };
}

interface ThreadFeedProps {
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor?: string;
  limit?: number;
}

export const ThreadFeed = ({
  currentUserId,
  currentUsername,
  currentUserColor,
  limit = 20
}: ThreadFeedProps) => {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [likesMap, setLikesMap] = useState<Map<string, { count: number; isLiked: boolean }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver>();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const initialLoadDone = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchLikesBatch = useCallback(async (threadIds: string[]) => {
    if (!threadIds.length) return;
    const idsParam = threadIds.join(",");
    const userParam = currentUserId ? `&user_uuid=${currentUserId}` : "";
    try {
      const resp = await fetch(`/api/rpc/get_thread_likes_batch?thread_ids=${idsParam}${userParam}`);
      const result = await resp.json();
      if (result.data && Array.isArray(result.data)) {
        setLikesMap(prev => {
          const next = new Map(prev);
          for (const item of result.data) {
            next.set(item.thread_id, { count: item.count, isLiked: item.is_liked });
          }
          return next;
        });
      }
    } catch {
      // silently ignore — UI shows 0 likes
    }
  }, [currentUserId]);

  const loadThreads = useCallback(async (isLoadMore = false) => {
    try {
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      let url = `/api/v1/threads?order=updated_at.desc&limit=${limit + 1}`;
      if (isLoadMore && cursor) {
        url += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      let threadsData = (result.data || []) as Record<string, unknown>[];
      const nextCursor = result.next_cursor || null;

      const hasMoreData = threadsData.length > limit;
      if (hasMoreData) {
        threadsData = threadsData.slice(0, limit);
      }

      if (currentUserId && !isLoadMore && !initialLoadDone.current) {
        initialLoadDone.current = true;
        const { data: recommended, error: recError } = await api.rpc(
          "get_recommended_threads",
          {
            user_uuid: currentUserId,
            limit_count: limit,
            offset_count: 0
          }
        );

        if (!recError && recommended && (recommended as Array<{ thread_id: string; score: number }>).length > 0) {
          const recommendedIds = (recommended as Array<{ thread_id: string; score: number }>).map((r) => r.thread_id);
          const recResponse = await fetch(`/api/v1/threads?id=in.(${recommendedIds.join(',')})&limit=${limit}`);
          const recResult = await recResponse.json();
          const recThreadsData = (recResult.data || []) as Record<string, unknown>[];

          if (recThreadsData.length > 0) {
            const sortedRecThreads = recThreadsData.map(thread => ({
              ...thread,
              profiles: {
                username: (thread.username as string) || "Аноним",
                is_anonymous: Boolean(thread.is_anonymous),
                avatar_url: thread.avatar_url as string | null,
              },
            })) as unknown as Thread[];

            sortedRecThreads.sort((a, b) => {
              const aScore = (recommended as Array<{ thread_id: string; score: number }>).find((r) => r.thread_id === a.id)?.score || 0;
              const bScore = (recommended as Array<{ thread_id: string; score: number }>).find((r) => r.thread_id === b.id)?.score || 0;
              return bScore - aScore;
            });

            setThreads(sortedRecThreads);
            setLoading(false);
            fetchLikesBatch(sortedRecThreads.map(t => t.id));
            return;
          }
        }
      }

      if (!threadsData.length) {
        if (!isLoadMore) setThreads([]);
        setHasMore(false);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      const threadsWithProfiles = threadsData.map(thread => ({
        ...thread,
        profiles: {
          username: (thread.username as string) || "Аноним",
          is_anonymous: Boolean(thread.is_anonymous),
          avatar_url: thread.avatar_url as string | null,
        },
      })) as unknown as Thread[];

      if (isLoadMore) {
        setThreads(prev => [...prev, ...threadsWithProfiles]);
        fetchLikesBatch(threadsWithProfiles.map(t => t.id));
      } else {
        setThreads(threadsWithProfiles);
        fetchLikesBatch(threadsWithProfiles.map(t => t.id));
      }

      setCursor(nextCursor);
      setHasMore(hasMoreData && nextCursor !== null);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error("Error in loadThreads:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [currentUserId, cursor, limit, fetchLikesBatch]);

  useEffect(() => {
    loadThreads();
    return () => { abortRef.current?.abort(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          loadThreads(true);
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
  }, [hasMore, loadingMore, loading, loadThreads]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {threads.map((thread) => {
        const likes = likesMap.get(thread.id);
        return (
          <ThreadCard
            key={thread.id}
            thread={thread}
            currentUserId={currentUserId}
            currentUsername={currentUsername}
            currentUserColor={currentUserColor}
            showPreview={true}
            initialLikesCount={likes?.count ?? 0}
            initialUserLiked={likes?.isLiked ?? false}
          />
        );
      })}

      <div ref={loadMoreRef} className="py-4">
        {loadingMore && (
          <div className="flex justify-center">
            <PentagramLoader size="md" />
          </div>
        )}
        {!hasMore && threads.length > 0 && (
          <div className="text-center text-muted-foreground py-4">
            Больше тредов нет
          </div>
        )}
      </div>
    </div>
  );
};
