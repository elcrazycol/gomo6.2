import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { ImageGallery } from "@/components/ImageGallery";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { wsService } from "@/services/websocket";

import { CreateWallPost } from "@/components/CreateWallPost";
import { WallPostCard } from "@/components/WallPostCard";
import {
  type WallPost,
  normalizeWallPostRecord,
  getWallPostPath,
} from "@/utils/wallNormalizers";
import { safeDate } from "@/utils/safeDate";

interface ProfileWallProps {
  profileUserId: string;
  currentUserId: string | null;
  currentUsername: string;
  canPost: boolean;
  showWall: boolean;
  focusedPostId?: string | null;
  standalone?: boolean;
}

export const ProfileWall = ({
  profileUserId,
  currentUserId,
  currentUsername,
  canPost,
  showWall,
  focusedPostId = null,
  standalone = false,
}: ProfileWallProps) => {
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [galleryImages, setGalleryImages] = useState<string[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // Use refs for tracking pending posts to avoid stale closure issues
  const pendingPostIdRef = useRef<string | undefined>(undefined);
  const pendingPostTimestampRef = useRef<number | undefined>(undefined);
  const processedPostIdsRef = useRef<Set<string>>(new Set());

  // Use ref for currentUsername to avoid stale closures in WebSocket handlers
  const currentUsernameRef = useRef(currentUsername);
  currentUsernameRef.current = currentUsername;

  const [pendingPostId, setPendingPostId] = useState<string | undefined>(undefined);
  const [pendingPostTimestamp, setPendingPostTimestamp] = useState<number | undefined>(undefined);
  const activeEditingPost = useMemo(
    () => posts.find((post) => post.id === editingPost),
    [editingPost, posts]
  );

  const loadPosts = useCallback(async () => {
    try {
      setLoading(true);
      let query = api
        .from("profile_wall_posts")
        .select(`\n          id,\n          user_id,\n          author_id,\n          title,\n          content,\n          content_json,\n          image_url,\n          attachments,\n          repost_of_post_id,\n          created_at,\n          updated_at,\n          is_pinned,\n          pinned_order,\n          author:profiles!author_id (\n            username,\n            is_anonymous,\n            avatar_url\n          )\n        `)
        .eq("user_id", profileUserId);

      if (focusedPostId) {
        query = query.eq("id", focusedPostId);
      } else {
        query = query
          .order("is_pinned", { ascending: false })
          .order("pinned_order", { ascending: true })
          .order("created_at", { ascending: false });
      }

      const { data, error } = await query;
      if (error) throw error;

      const rawPosts = (data || []) as Record<string, unknown>[];
      const repostIds = Array.from(
        new Set(
          rawPosts
            .map((post) => post.repost_of_post_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0)
        )
      );

      let originalPostsMap = new Map<string, WallPost>();
      if (repostIds.length > 0) {
        const { data: originalPosts, error: originalPostsError } = await api
          .from("profile_wall_posts")
          .select(`\n            id,\n            user_id,\n            author_id,\n            title,\n            content,\n            content_json,\n            image_url,\n            attachments,\n            repost_of_post_id,\n            created_at,\n            updated_at,\n            is_pinned,\n            pinned_order,\n            author:profiles!author_id (\n              username,\n              is_anonymous,\n              avatar_url\n            )\n          `)
          .in("id", repostIds);

        if (originalPostsError) throw originalPostsError;

        originalPostsMap = new Map(
          ((originalPosts || []) as Record<string, unknown>[]).map((originalPost) => {
            const normalized = normalizeWallPostRecord(originalPost, currentUsernameRef.current);
            return [normalized.id, normalized];
          })
        );
      }

      const normalizedPosts = rawPosts.map((post) =>
        normalizeWallPostRecord({
          ...post,
          original_post: (post.repost_of_post_id as string | undefined) ? originalPostsMap.get(post.repost_of_post_id as string) || null : null,
        }, currentUsernameRef.current)
      );

      setPosts(prevPosts => {
        const validNormalized = normalizedPosts.filter(p => p.id);
        const validPrevPosts = prevPosts.filter(p => p.id);
        const apiPostIds = new Set(validNormalized.map(p => p.id));
        const websocketPosts = validPrevPosts.filter(post => !apiPostIds.has(post.id));

        const combinedPosts = [...validNormalized, ...websocketPosts];

        combinedPosts.sort((a, b) => {
          if (a.is_pinned && !b.is_pinned) return -1;
          if (!a.is_pinned && b.is_pinned) return 1;
          if (a.is_pinned && b.is_pinned) {
            if ((a.pinned_order ?? 0) !== (b.pinned_order ?? 0)) {
              return (a.pinned_order ?? 0) - (b.pinned_order ?? 0);
            }
          }
          return safeDate(b.created_at).getTime() - safeDate(a.created_at).getTime();
        });

        return combinedPosts;
      });
    } catch (error) {
      console.error("Error loading wall posts:", error);
      toast.error("Ошибка загрузки постов стены");
    } finally {
      setLoading(false);
    }
  }, [profileUserId, focusedPostId]);

  useEffect(() => {
    if (showWall) {
      loadPosts();
    }
  }, [profileUserId, showWall, loadPosts]);

  // WebSocket realtime subscription for wall posts
  useEffect(() => {
    if (!profileUserId || !currentUserId) return;

    const wallRoom = `profile_wall_${profileUserId}`;
    wsService.subscribe(wallRoom);

    const unsubscribeNewPost = wsService.on('new_wall_post', (message) => {
      if (message.data) {
        try {
          const postData = typeof message.data === 'string'
            ? JSON.parse(message.data)
            : message.data;

          if (!postData.id || !postData.user_id) return;
          if (postData.user_id !== profileUserId) return;

          const postId = String(postData.id);
          const postTimestamp = safeDate(postData.created_at).getTime();

          if (processedPostIdsRef.current.has(postId)) return;

          const currentPendingId = pendingPostIdRef.current;
          const currentPendingTimestamp = pendingPostTimestampRef.current;

          const isRecentPost = currentPendingTimestamp && (postTimestamp - currentPendingTimestamp) < 10000;
          const isPendingPost = currentPendingId && currentPendingId === postId;

          setPosts(prevPosts => {
            const existingPost = prevPosts.find(p => String(p.id) === postId);
            if (existingPost) {
              pendingPostIdRef.current = undefined;
              pendingPostTimestampRef.current = undefined;
              setPendingPostId(undefined);
              setPendingPostTimestamp(undefined);
              return prevPosts;
            }

            if (isRecentPost || isPendingPost) {
              pendingPostIdRef.current = undefined;
              pendingPostTimestampRef.current = undefined;
              setPendingPostId(undefined);
              setPendingPostTimestamp(undefined);
              return prevPosts;
            }

            processedPostIdsRef.current.add(postId);
            const newPost = normalizeWallPostRecord(postData, currentUsernameRef.current);
            return [newPost, ...prevPosts];
          });
        } catch (e) {
          console.error('[ProfileWall] Error parsing wall post message:', e);
        }
      }
    });

    const unsubscribeUpdatePost = wsService.on('update_wall_post', (message) => {
      if (message.data) {
        try {
          const postData = typeof message.data === 'string'
            ? JSON.parse(message.data)
            : message.data;
          if (!postData.id) return;
          setPosts(prevPosts =>
            prevPosts.map(post =>
              String(post.id) === String(postData.id)
                ? normalizeWallPostRecord(postData, currentUsernameRef.current)
                : post
            )
          );
        } catch (e) {
          // Silent error
        }
      }
    });

    const unsubscribeDeletePost = wsService.on('delete_wall_post', (message) => {
      if (message.data) {
        try {
          const postData = typeof message.data === 'string'
            ? JSON.parse(message.data)
            : message.data;
          if (!postData.id) return;
          const postId = String(postData.id);
          setPosts(prevPosts =>
            prevPosts.filter(post => String(post.id) !== postId)
          );
        } catch (e) {
          console.error('[ProfileWall] Error parsing delete wall post message:', e);
        }
      }
    });

    return () => {
      unsubscribeNewPost();
      unsubscribeUpdatePost();
      unsubscribeDeletePost();
    };
  }, [profileUserId, currentUserId]);

  const handleDeletePost = async (postId: string) => {
    if (!currentUserId) return;
    try {
      const postToDelete = posts.find(p => p.id === postId);
      if (postToDelete?.repost_of_post_id) {
        const { error: repostRecordError } = await api
          .from("profile_wall_post_reposts")
          .delete()
          .eq("reposted_wall_post_id", postId)
          .eq("user_id", currentUserId);
        if (repostRecordError) {
          console.error("Error deleting repost record:", repostRecordError);
        }
      }

      const { error } = await api
        .from("profile_wall_posts")
        .delete()
        .eq("id", postId)
        .or(`author_id.eq.${currentUserId},user_id.eq.${currentUserId}`);

      if (error) throw error;
      setPosts((prev) => prev.filter((post) => post.id !== postId));
      toast.success("Пост удален");
    } catch (error) {
      console.error("Error deleting post:", error);
      toast.error("Ошибка удаления поста");
    }
  };

  const handleTogglePin = async (postId: string) => {
    if (!currentUserId) {
      toast.error("Не авторизован");
      return;
    }
    try {
      const { data, error } = await api.rpc("toggle_wall_post_pin", {
        _post_id: postId,
        _user_id: currentUserId,
      });
      if (error) throw error;
      if (!data) {
        toast.error("У вас нет прав на закрепление этого поста");
        return;
      }
      await loadPosts();
      toast.success("Статус закрепления изменен");
    } catch (error) {
      console.error("Error toggling pin:", error);
      toast.error("Ошибка изменения закрепления");
    }
  };

  const handlePostCreated = (newPost: WallPost) => {
    const markedPost = {
      ...normalizeWallPostRecord(newPost as unknown as Record<string, unknown>, currentUsername),
      _localAdd: true
    };
    setPosts((prev) => [markedPost, ...prev]);
    setShowCreateForm(false);
    setTimeout(() => {
      pendingPostTimestampRef.current = undefined;
      pendingPostIdRef.current = undefined;
      setPendingPostTimestamp(undefined);
      setPendingPostId(undefined);
    }, 5000);
  };

  const handlePostCreatedWithTimestamp = (newPost: WallPost) => {
    handlePostCreated(newPost);
  };

  const handleBeforeCreate = () => {
    const timestamp = Date.now();
    const tempId = crypto.randomUUID();
    pendingPostTimestampRef.current = timestamp;
    pendingPostIdRef.current = tempId;
    setPendingPostTimestamp(timestamp);
    setPendingPostId(tempId);
    return tempId;
  };

  const handlePostUpdated = (updatedPost: WallPost) => {
    setPosts((prev) => prev.map((post) => (post.id === updatedPost.id ? normalizeWallPostRecord(updatedPost as unknown as Record<string, unknown>, currentUsername) : post)));
    setEditingPost(null);
  };

  if (!showWall) {
    return null;
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-14 rounded-3xl bg-muted" />
          <div className="h-40 rounded-3xl bg-muted" />
          <div className="h-40 rounded-3xl bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {canPost && !standalone && !focusedPostId && (
          <div className="flex justify-end">
            <div className="relative w-full max-w-3xl">
              <div className={`flex ${showCreateForm ? "justify-start" : "justify-end"} transition-all duration-300 ease-out`}>
                <Button
                  variant="default"
                  size="icon"
                  onClick={() => {
                    setEditingPost(null);
                    setShowCreateForm((prev) => !prev);
                  }}
                  className={`z-20 h-12 w-12 rounded-2xl text-xl shadow-lg transition-all duration-300 ease-out ${
                    showCreateForm ? "absolute right-4 top-0" : "relative"
                  }`}
                  title={showCreateForm ? "Скрыть форму" : "Написать на стене"}
                >
                  <Plus className={`h-5 w-5 transition-transform duration-300 ease-out ${showCreateForm ? "rotate-45" : "rotate-0"}`} />
                </Button>
              </div>

              <div
                className={`origin-top-right overflow-hidden transition-all duration-300 ease-out ${
                  showCreateForm && currentUserId
                    ? "max-h-[1200px] translate-y-0 opacity-100"
                    : "pointer-events-none max-h-0 -translate-y-2 opacity-0"
                }`}
              >
                <div className="pt-3">
                  {currentUserId && (
                    <CreateWallPost
                      key={showCreateForm ? "wall-create-open" : "wall-create-closed"}
                      profileUserId={profileUserId}
                      currentUserId={currentUserId}
                      onPostCreated={handlePostCreatedWithTimestamp}
                      onBeforeCreate={handleBeforeCreate}
                      onCancel={() => setShowCreateForm(false)}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {posts.length === 0 ? (
          <div className="border border-dashed border-border/70 bg-muted/20 py-12 text-center">
            <p className="text-lg font-medium">
              {focusedPostId ? "Запись на стене не найдена" : "На стене пока тихо"}
            </p>
            {!focusedPostId && canPost && <p className="mt-2 text-sm text-muted-foreground">Нажмите `+`, чтобы оставить первую запись.</p>}
          </div>
        ) : (
          <div className="space-y-4">
            {posts
              .filter(post => post.id)
              .map((post, index) => (
              <WallPostCard
                key={`${post.id}-${post.created_at}-${index}`}
                post={post}
                profileUserId={profileUserId}
                currentUserId={currentUserId}
                currentUsername={currentUsername}
                currentProfileUsername={currentUsername}
                isEditing={editingPost === post.id && currentUserId !== null && activeEditingPost?.id === post.id}
                onStartEditing={() => setEditingPost(post.id)}
                onCancelEditing={() => setEditingPost(null)}
                onPostUpdated={handlePostUpdated}
                onDeletePost={handleDeletePost}
                onTogglePin={handleTogglePin}
                onRefreshPosts={loadPosts}
                forceCommentsOpen={Boolean(focusedPostId)}
                postHref={focusedPostId ? null : getWallPostPath(post.user_id, post.id)}
                standalone={standalone}
                onImageClick={(images, idx) => {
                  setGalleryImages(images);
                  setGalleryIndex(idx);
                }}
              />
            ))}
          </div>
        )}
      </div>
      {!!galleryImages && (
        <ImageGallery
          images={galleryImages}
          initialIndex={galleryIndex}
          onClose={() => setGalleryImages(null)}
        />
      )}
    </>
  );
};
