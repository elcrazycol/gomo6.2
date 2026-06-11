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
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver>();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const initialLoadDone = useRef(false);

  const loadThreads = useCallback(async (isLoadMore = false) => {
    try {
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      // Build URL with cursor-based pagination
      let url = `/api/v1/threads?order=updated_at.desc&limit=${limit}`;
      if (isLoadMore && cursor) {
        url += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const response = await fetch(url);
      const result = await response.json();
      const threadsData = (result.data || []) as Record<string, unknown>[];
      const nextCursor = result.next_cursor || null;

      // If user is logged in and this is the initial load, try recommendations
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

        if (!recError && recommended && (recommended as any[]).length > 0) {
          // Get full thread data for recommendations
          const recommendedIds = (recommended as any[]).map((r: any) => r.thread_id);
          const recResponse = await fetch(`/api/v1/threads?id=in.(${recommendedIds.join(',')})&limit=${limit}`);
          const recResult = await recResponse.json();
          const recThreadsData = (recResult.data || []) as Record<string, unknown>[];

          if (recThreadsData.length > 0) {
            // Get profiles separately
            const userIds = recThreadsData.map(t => t.user_id as string).filter(Boolean);
            const profilesResponse = await fetch(`/api/v1/profiles?id=in.(${[...new Set(userIds)].join(',')})`);
            const profilesResult = await profilesResponse.json();
            const profilesData = (profilesResult.data || []) as { id: string; username: string; is_anonymous: boolean; avatar_url?: string | null }[];

            // Combine threads with profiles
            const recThreadsWithProfiles = recThreadsData.map(thread => ({
              ...thread,
              profiles: profilesData.find(profile => profile.id === thread.user_id) || null
            })) as unknown as Thread[];

            // Sort by recommendation score
            const sortedRecThreads = recThreadsWithProfiles.sort((a, b) => {
              const aScore = (recommended as any[]).find((r: any) => r.thread_id === a.id)?.score || 0;
              const bScore = (recommended as any[]).find((r: any) => r.thread_id === b.id)?.score || 0;
              return bScore - aScore;
            });

            setThreads(sortedRecThreads);
            setLoading(false);
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

      // Get profiles separately
      const userIds = threadsData.map(t => t.user_id as string).filter(Boolean);
      const profilesResponse = await fetch(`/api/v1/profiles?id=in.(${[...new Set(userIds)].join(',')})`);
      const profilesResult = await profilesResponse.json();
      const profilesData = (profilesResult.data || []) as { id: string; username: string; is_anonymous: boolean; avatar_url?: string | null }[];

      // Combine threads with profiles
      const threadsWithProfiles = threadsData.map(thread => ({
        ...thread,
        profiles: profilesData.find(profile => profile.id === thread.user_id) || null
      })) as unknown as Thread[];

      if (isLoadMore) {
        setThreads(prev => [...prev, ...threadsWithProfiles]);
      } else {
        setThreads(threadsWithProfiles);
      }

      // Update cursor for next page
      setCursor(nextCursor);
      setHasMore(nextCursor !== null && threadsData.length >= limit);
    } catch (error) {
      console.error("Error in loadThreads:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [currentUserId, cursor, limit]);

  useEffect(() => {
    loadThreads();
  }, []); // Only on mount

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
      {threads.map((thread) => (
        <ThreadCard
          key={thread.id}
          thread={thread}
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          currentUserColor={currentUserColor}
          showPreview={true}
        />
      ))}

      {/* Load More Trigger */}
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
