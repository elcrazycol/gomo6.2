import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/api/client_simple";
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
  const [offset, setOffset] = useState(0);
  const observerRef = useRef<IntersectionObserver>();
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async (isLoadMore = false) => {
    try {
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      // Get threads without profiles first
      const { data: threadsData, error } = await supabase
        .from("threads")
        .select(`
          id,
          title,
          content,
          image_url,
          image_urls,
          created_at,
          updated_at,
          user_id,
          board_id,
          tags,
          ephemeral_type,
          ephemeral_value,
          auto_delete_at,
          post_count,
          boards!inner (
            slug,
            name,
            is_gomosub
          )
        `)
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1);

      // If user is logged in, try to get recommendations first
      if (currentUserId && !isLoadMore) {
        const { data: recommended, error: recError } = await supabase.rpc(
          "get_recommended_threads",
          {
            user_uuid: currentUserId,
            limit_count: limit,
            offset_count: 0
          }
        );

        if (!recError && recommended && recommended.length > 0) {
          // Get full thread data for recommendations
          const recommendedIds = (recommended as any[]).map((r: any) => r.thread_id);
          const { data: recThreadsData, error: recThreadsError } = await supabase
            .from("threads")
            .select(`
              id,
              title,
              content,
              image_url,
              image_urls,
              created_at,
              updated_at,
              user_id,
              board_id,
              tags,
              ephemeral_type,
              ephemeral_value,
              auto_delete_at,
              post_count,
              boards!inner (
                slug,
                name,
                is_gomosub
              )
            `)
            .in("id", recommendedIds);

          if (!recThreadsError && recThreadsData && recThreadsData.length > 0) {
            // Get profiles separately
            const userIds = recThreadsData.map(thread => thread.user_id).filter(Boolean);
            const { data: profilesData } = await supabase
              .from("profiles")
              .select("id, username, is_anonymous, avatar_url")
              .in("id", userIds);

            // Combine threads with profiles
            const recThreadsWithProfiles = recThreadsData.map(thread => ({
              ...thread,
              profiles: profilesData?.find(profile => profile.id === thread.user_id) || null
            }));

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

      // Fallback to regular chronological feed
      if (error) {
        console.error("Error loading threads:", error);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      if (threadsData && threadsData.length > 0) {
        // Get profiles separately
        const userIds = threadsData.map(thread => thread.user_id).filter(Boolean);
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("id, username, is_anonymous, avatar_url")
          .in("id", userIds);

        // Combine threads with profiles
        const threadsWithProfiles = threadsData.map(thread => ({
          ...thread,
          profiles: profilesData?.find(profile => profile.id === thread.user_id) || null
        }));

        if (isLoadMore) {
          setThreads(prev => [...prev, ...threadsWithProfiles]);
        } else {
          setThreads(threadsWithProfiles);
        }

        if (threadsData.length < limit) {
          setHasMore(false);
        }
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Error in loadThreads:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [currentUserId, offset, limit]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          setOffset(prev => prev + limit);
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
  }, [hasMore, loadingMore, loading, limit, loadThreads]);

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
