import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { api } from "@/integrations/api/compat";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { Lock } from "lucide-react";
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

// Keyset pagination: the server returns has_more/next_cursor keyed on
// (created_at, id), so local inserts/deletes never shift the page window.
// Pinned posts are only returned on the first page.
const PAGE_SIZE = 10;

// Minimum delay between auto-loads triggered by the scroll sentinel. Prevents
// a burst of page fetches when the sentinel stays visible after an append
// (e.g. a page of short text-only posts) — mirrors ThreadFeed's cooldown.
const LOAD_MORE_COOLDOWN_MS = 1500;

// One canonical wall order: pinned first (by pinned_order), then newest. Used
// by both the initial load and load-more merges so the list stays in the same
// order the server returns after any WS/local insert.
const sortWallPosts = (list: WallPost[]): WallPost[] =>
  [...list].sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    if (a.is_pinned && b.is_pinned && (a.pinned_order ?? 0) !== (b.pinned_order ?? 0)) {
      return (a.pinned_order ?? 0) - (b.pinned_order ?? 0);
    }
    return safeDate(b.created_at).getTime() - safeDate(a.created_at).getTime();
  });

interface ProfileWallProps {
  profileUserId: string;
  currentUserId: string | null;
  currentUsername: string;
  canPost: boolean;
  showWall: boolean;
  focusedPostId?: string | null;
  standalone?: boolean;
  /** Autoplay the focused post's video (opened via a wall-video tap). */
  autoplayVideo?: boolean;
  /** Increment to force a refetch (e.g. after the profile owner's nickname emoji changes). */
  refreshKey?: number;
  /**
   * The wall is hidden from this viewer on the server (e.g. a non-friend on a
   * private profile, or a public profile whose owner hid the wall). Renders a
   * "private profile" notice instead of fetching posts and showing the
   * misleading "empty wall" state.
   */
  wallHidden?: boolean;
  /** True when the wall owner's profile is private (used to word the notice). */
  privateProfile?: boolean;
  /** Already loaded post from the previous screen, used to avoid a skeleton
   * flash while the focused-post request refreshes in the background. */
  initialPost?: WallPost | null;
  /**
   * External control of the create-post form. The "Написать на стене" button
   * now lives on the profile page (floating, always on screen) and drives this
   * state from outside. When omitted, the form keeps its internal state.
   */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}

export const ProfileWall = ({
  profileUserId,
  currentUserId,
  currentUsername,
  canPost,
  showWall,
  focusedPostId = null,
  standalone = false,
  autoplayVideo = false,
  refreshKey = 0,
  wallHidden = false,
  privateProfile = false,
  initialPost = null,
  createOpen = false,
  onCreateOpenChange,
}: ProfileWallProps) => {
  const [posts, setPosts] = useState<WallPost[]>(() => initialPost ? [initialPost] : []);
  const [loading, setLoading] = useState(!initialPost);
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  // The create form is controlled from the profile page when
  // onCreateOpenChange is provided; otherwise it keeps its internal state.
  const createOpenControlled = onCreateOpenChange !== undefined;
  const showCreateForm = createOpenControlled ? createOpen : internalCreateOpen;
  const setShowCreateForm = (open: boolean) => {
    if (createOpenControlled) {
      onCreateOpenChange(open);
    } else {
      setInternalCreateOpen(open);
    }
  };
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [galleryItems, setGalleryItems] = useState<LightboxItem[] | null>(null);
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

  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Next server-side keyset cursor (opaque) — independent of the rendered
  // array so local/WS inserts and deletes never shift the pagination window.
  const nextCursorRef = useRef<string | null>(null);
  // Latest-value refs so the long-lived scroll observer never closes over
  // stale state (mirrors the ThreadFeed pattern).
  const hasMoreRef = useRef(false);
  const loadMoreRef = useRef<() => void>(() => {});
  const nextLoadMoreAtRef = useRef(0);
  // The wall owner the current state belongs to — resets everything when the
  // owner changes (the route keeps the component mounted across profiles).
  const lastOwnerRef = useRef<string | null>(null);
  const activeEditingPost = useMemo(
    () => posts.find((post) => post.id === editingPost),
    [editingPost, posts]
  );

  // Reset wall state when the owner changes: /profile/A → /profile/B keeps
  // the same mounted instance, and the loadPosts merge would otherwise keep
  // the previous profile's posts (their ids aren't in the new page, so they
  // would survive as "websocket posts"). Runs on mount too to seed the ref.
  useEffect(() => {
    if (lastOwnerRef.current === profileUserId) return;
    lastOwnerRef.current = profileUserId;
    setPosts(initialPost ? [initialPost] : []);
    setHasMore(false);
    nextCursorRef.current = null;
    setLoading(!initialPost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileUserId]);

  useEffect(() => {
    if (!initialPost) return;
    setPosts([initialPost]);
    setLoading(false);
  }, [initialPost]);

  // Keep the observer's snapshot of hasMore fresh.
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  // Fetch one page of wall posts (already normalized, repost originals
  // resolved). The server returns has_more/next_cursor (keyset pagination),
  // so the caller never has to guess whether another page exists. Pass
  // cursor=null for the first page — pinned posts only appear there.
  const fetchWallPage = useCallback(async (
    cursor: string | null,
    pageSize: number
  ): Promise<{ posts: WallPost[]; hasMore: boolean; nextCursor: string | null }> => {
    let query = api
      .from("profile_wall_posts")
      .select(WALL_POST_SELECT)
      .eq("user_id", profileUserId);

    if (focusedPostId) {
      query = query.eq("id", focusedPostId);
    } else {
      query = query
        .order("is_pinned", { ascending: false })
        .order("pinned_order", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(pageSize);
      if (cursor) query = query.cursor(cursor);
    }

    const result = (await query) as {
      data: Record<string, unknown>[] | null;
      error: unknown;
      has_more?: boolean;
      next_cursor?: string | null;
    };
    if (result.error) throw result.error;

    const rawPosts = result.data || [];
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
        .select(WALL_POST_SELECT)
        .in("id", repostIds);

      if (originalPostsError) throw originalPostsError;

      originalPostsMap = new Map(
        ((originalPosts || []) as Record<string, unknown>[]).map((originalPost) => {
          const normalized = normalizeWallPostRecord(originalPost, currentUsernameRef.current);
          return [normalized.id, normalized];
        })
      );
    }

    const posts = rawPosts.map((post) =>
      normalizeWallPostRecord({
        ...post,
        original_post: (post.repost_of_post_id as string | undefined) ? originalPostsMap.get(post.repost_of_post_id as string) || null : null,
      }, currentUsernameRef.current)
    );
    return {
      posts,
      hasMore: result.has_more === true,
      nextCursor: typeof result.next_cursor === "string" ? result.next_cursor : null,
    };
  }, [focusedPostId, profileUserId]);

  const loadPosts = useCallback(async () => {
    const ownerAtFetch = lastOwnerRef.current;
    try {
      // A post passed by the previous screen is already renderable. Refresh it
      // in the background without replacing it with a loading skeleton.
      if (!initialPost) setLoading(true);
      const { posts: fetchedPosts, hasMore: hasMoreData, nextCursor } = await fetchWallPage(null, PAGE_SIZE);
      if (ownerAtFetch !== lastOwnerRef.current) return; // owner switched mid-flight
      nextCursorRef.current = nextCursor;

      setPosts(prevPosts => {
        const validNormalized = fetchedPosts.filter(p => p.id);
        const validPrevPosts = prevPosts.filter(p => p.id);
        const apiPostIds = new Set(validNormalized.map(p => p.id));
        // Posts the API page doesn't know (optimistic local creates / WS
        // events that arrived mid-flight) survive the refresh.
        const websocketPosts = validPrevPosts.filter(post => !apiPostIds.has(post.id));
        return sortWallPosts([...validNormalized, ...websocketPosts]);
      });
      setHasMore(!focusedPostId && hasMoreData);
    } catch (error) {
      if (ownerAtFetch !== lastOwnerRef.current) return;
      console.error("Error loading wall posts:", error);
      toast.error("Ошибка загрузки постов стены");
    } finally {
      if (ownerAtFetch === lastOwnerRef.current) setLoading(false);
    }
  }, [fetchWallPage, focusedPostId, initialPost]);

  const loadMorePosts = useCallback(async () => {
    if (loadingMoreRef.current || loading || !hasMoreRef.current) return;
    const ownerAtFetch = lastOwnerRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const cursor = nextCursorRef.current;
      // hasMore without a cursor means there is nothing more to fetch — stop
      // (the server only reports has_more when it also returns a cursor).
      if (!cursor) {
        setHasMore(false);
        return;
      }
      const { posts: fetchedPosts, hasMore: hasMoreData, nextCursor } = await fetchWallPage(cursor, PAGE_SIZE);
      if (ownerAtFetch !== lastOwnerRef.current) return; // owner switched mid-flight
      nextCursorRef.current = nextCursor;

      if (fetchedPosts.length === 0) {
        setHasMore(false);
        return;
      }
      setPosts(prevPosts => {
        const existingIds = new Set(prevPosts.filter(p => p.id).map(p => p.id));
        const appended = fetchedPosts.filter(p => p.id && !existingIds.has(p.id));
        return sortWallPosts([...prevPosts, ...appended]);
      });
      setHasMore(hasMoreData);
    } catch (error) {
      if (ownerAtFetch !== lastOwnerRef.current) return;
      console.error("Error loading more wall posts:", error);
      toast.error("Ошибка загрузки постов стены");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [fetchWallPage, loading]);

  // Keep the observer's snapshot of the loader fresh — the observer is only
  // created/destroyed when hasMore toggles, never on every posts change.
  loadMoreRef.current = loadMorePosts;

  // Infinite scroll: fetch the next page when the sentinel enters the viewport.
  useEffect(() => {
    if (!hasMore || focusedPostId) return;
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(entry => entry.isIntersecting) && Date.now() >= nextLoadMoreAtRef.current) {
          nextLoadMoreAtRef.current = Date.now() + LOAD_MORE_COOLDOWN_MS;
          loadMoreRef.current();
        }
      },
      { rootMargin: "600px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, focusedPostId]);

  useEffect(() => {
    if (showWall && !wallHidden) {
      loadPosts();
    }
  }, [profileUserId, showWall, refreshKey, loadPosts, wallHidden]);

  // WebSocket realtime subscription for wall posts
  useEffect(() => {
    if (!profileUserId || !currentUserId || wallHidden) return;

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
          // A message queued while the wall owner switched must not leak onto
          // the new owner's wall.
          if (lastOwnerRef.current !== profileUserId) return;

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
            return sortWallPosts([newPost, ...prevPosts]);
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
  }, [profileUserId, currentUserId, wallHidden]);

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
    setPosts((prev) => sortWallPosts([markedPost, ...prev]));
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

  // The wall is hidden from this viewer server-side — show an explanatory
  // notice instead of the "empty wall" state (which would be misleading).
  if (wallHidden) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground/70" />
        <p className="text-lg font-medium">
          {privateProfile ? "Приватный профиль" : "Стена скрыта"}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {privateProfile
            ? "Это приватный профиль — стена скрыта от не-друзей."
            : "Владелец скрыл стену — она доступна только друзьям."}
        </p>
      </div>
    );
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
        {canPost && !standalone && !focusedPostId && showCreateForm && currentUserId && (
          <CreateWallPost
            profileUserId={profileUserId}
            currentUserId={currentUserId}
            onPostCreated={handlePostCreatedWithTimestamp}
            onBeforeCreate={handleBeforeCreate}
            onCancel={() => setShowCreateForm(false)}
          />
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
                autoplayVideo={autoplayVideo && post.id === focusedPostId}
                onImageClick={(items, idx) => {
                  setGalleryItems(items);
                  setGalleryIndex(idx);
                }}
              />
            ))}
          </div>
        )}
        {!focusedPostId && hasMore && (
          <div
            ref={sentinelRef}
            data-testid="wall-sentinel"
            className="flex justify-center py-4"
          >
            {loadingMore && (
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
            )}
          </div>
        )}
      </div>
      {!!galleryItems && (
        <Lightbox
          items={galleryItems}
          initialIndex={galleryIndex}
          onClose={() => setGalleryItems(null)}
        />
      )}

      {/* Edit an existing post through the same overlay composer. */}
      {activeEditingPost && currentUserId && (
        <CreateWallPost
          profileUserId={profileUserId}
          currentUserId={currentUserId}
          editingPost={activeEditingPost}
          onPostUpdated={handlePostUpdated}
          onCancel={() => setEditingPost(null)}
        />
      )}
    </>
  );
};
