import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { CreateWallPost } from "@/components/CreateWallPost";
import { WallPostCard } from "@/components/WallPostCard";
import { PentagramLoader } from "@/components/PentagramLoader";
import { normalizeWallPostRecord, getWallPostPath, type WallPost } from "@/utils/wallNormalizers";
import { storageUrl } from "@/utils/storage";

interface ProfileAlbumViewProps {
  album: { id: string; name: string; post_count: number };
  profileUserId: string;
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor: string;
  isOwnProfile: boolean;
  /** Add the given wall posts to the album (parent owns the API call). */
  onAddPosts: (postIds: string[]) => Promise<void>;
  /** Remove one wall post from the album. */
  onRemovePost: (postId: string) => Promise<void>;
  onRenameAlbum: (name: string) => Promise<void>;
  onDeleteAlbum: () => Promise<void>;
  /** Fired after any membership change so the parent refreshes album counts. */
  onAlbumPostsChanged: () => void;
}

// Album posts are keyset-paginated exactly like the wall: limit + an opaque
// next_cursor echoed back by the client (newest-added first, keyed on the
// album membership row's added_at). Long albums no longer load in one request.
const PAGE_SIZE = 10;

// Minimum delay between auto-loads triggered by the scroll sentinel. Prevents
// a burst of page fetches when the sentinel stays visible after an append —
// mirrors the ProfileWall/ThreadFeed cooldown.
const LOAD_MORE_COOLDOWN_MS = 1500;
// How far past the viewport edge the sentinel may sit and still count as "the
// user wants the next page". Kept in sync with the observer's rootMargin and
// reused by the post-append re-check: the observer only fires on intersection
// *changes*, so after a fast scroll the sentinel can stay visible without a
// single new callback — the re-check has to evaluate the same zone itself.
const LOAD_MORE_TRIGGER_MARGIN_PX = 600;

/** Album view inside the wall tab: the album's posts plus the minimalistic
 * management panel (add/remove posts, rename, delete). Reuses WallPostCard
 * with the same interaction wiring as ProfileWall. */
export function ProfileAlbumView({
  album,
  profileUserId,
  currentUserId,
  currentUsername,
  currentUserColor,
  isOwnProfile,
  onAddPosts,
  onRemovePost,
  onRenameAlbum,
  onDeleteAlbum,
  onAlbumPostsChanged,
}: ProfileAlbumViewProps) {
  const { t } = useTranslation();

  const [posts, setPosts] = useState<WallPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [galleryItems, setGalleryItems] = useState<LightboxItem[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // Add/remove posts picker.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerPosts, setPickerPosts] = useState<WallPost[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickerBusy, setPickerBusy] = useState(false);

  // Rename / delete dialogs.
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(album.name);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Keyset pagination state — refs so the long-lived scroll machinery never
  // closes over stale values (the same pattern ProfileWall uses).
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const nextCursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const nextLoadMoreAtRef = useRef(0);
  const retryPendingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const loadMoreRef = useRef<() => void>(() => {});
  const requestLoadMoreRef = useRef<() => void>(() => {});
  // The album id the current state belongs to — resets pagination when the
  // parent switches albums without remounting this component.
  const lastAlbumIdRef = useRef<string | null>(null);

  const clearLoadMoreRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // Fetch one page of album posts. cursor=null means the first page — the
  // response replaces the list; the caller appends only cursor pages.
  const fetchAlbumPage = useCallback(async (cursor: string | null, pageSize: number) => {
    let url = `/api/v1/profile_album_posts?album_id=eq.${album.id}&limit=${pageSize}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    const res = await fetch(url);
    const json = await res.json();
    const raw = (json.data as Record<string, unknown>[]) || [];
    return {
      posts: raw.map((row) => normalizeWallPostRecord(row, currentUsername)),
      hasMore: json.has_more === true,
      nextCursor: typeof json.next_cursor === "string" ? json.next_cursor : null,
    };
  }, [album.id, currentUsername]);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const { posts: fetched, hasMore: hasMoreData, nextCursor } = await fetchAlbumPage(null, PAGE_SIZE);
      setPosts(fetched);
      setHasMore(hasMoreData);
      nextCursorRef.current = nextCursor;
    } catch (error) {
      console.error("Error loading album posts:", error);
      toast.error(t("profile.threadsLoadError"));
    } finally {
      setLoading(false);
    }
  }, [fetchAlbumPage, t]);

  const loadMorePosts = useCallback(async () => {
    if (loadingMoreRef.current || loading || !hasMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const cursor = nextCursorRef.current;
      // hasMore without a cursor means there is nothing more to fetch — the
      // server only reports has_more when it also returns a cursor.
      if (!cursor) {
        setHasMore(false);
        return;
      }
      const { posts: fetched, hasMore: hasMoreData, nextCursor } = await fetchAlbumPage(cursor, PAGE_SIZE);
      nextCursorRef.current = nextCursor;
      if (fetched.length === 0) {
        setHasMore(false);
        return;
      }
      setPosts((prev) => {
        const existingIds = new Set(prev.filter((p) => p.id).map((p) => p.id));
        return [...prev, ...fetched.filter((p) => p.id && !existingIds.has(p.id))];
      });
      setHasMore(hasMoreData);
    } catch (error) {
      console.error("Error loading more album posts:", error);
      toast.error(t("profile.threadsLoadError"));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
      // The observer only fires on intersection changes, so an append that
      // leaves the sentinel visible (fast scrolling past the bottom) would
      // never re-trigger it by itself. Re-check right after settling —
      // requestLoadMore fetches the next page or re-arms its cooldown timer.
      requestLoadMoreRef.current();
    }
  }, [fetchAlbumPage, loading, t]);

  // Keep the scroll machinery's snapshots fresh.
  loadMoreRef.current = loadMorePosts;
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  // Reset pagination when the album changes — the parent keeps this component
  // mounted while switching selectedAlbum, and stale pages must not leak.
  useEffect(() => {
    if (lastAlbumIdRef.current === album.id) return;
    lastAlbumIdRef.current = album.id;
    clearLoadMoreRetry();
    retryPendingRef.current = false;
    setPosts([]);
    setHasMore(false);
    nextCursorRef.current = null;
    setLoading(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album.id]);

  useEffect(() => {
    loadPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album.id, currentUsername]);

  // Is the sentinel still within LOAD_MORE_TRIGGER_MARGIN_PX of the viewport?
  // Mirrors the intersection check the observer performs, but callable on
  // demand — e.g. right after a page of posts was appended.
  const isSentinelInTriggerZone = useCallback(() => {
    const el = sentinelRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const viewportBottom = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.top <= viewportBottom + LOAD_MORE_TRIGGER_MARGIN_PX && rect.bottom >= -LOAD_MORE_TRIGGER_MARGIN_PX;
  }, []);

  // Single entry point for "the user wants more posts". Never drops a
  // trigger: if a fetch is already running (fast scroll piling up events) or
  // the cooldown is active, the request is re-armed — a flag re-evaluated from
  // loadMorePosts' finally, plus a timer that wakes up when the cooldown
  // expires — instead of being consumed and forgotten.
  const requestLoadMore = useCallback(() => {
    if (!hasMoreRef.current) return;
    if (loadingMoreRef.current) {
      // A page fetch is in flight — re-evaluate when it settles.
      retryPendingRef.current = true;
      return;
    }
    // Demand-driven: only fetch while the sentinel is (still) near the
    // viewport, unless a trigger is pending from while we were mid-fetch.
    if (!retryPendingRef.current && !isSentinelInTriggerZone()) return;
    const waitMs = nextLoadMoreAtRef.current - Date.now();
    if (waitMs > 0) {
      // Cooldown active and no further observer callback is coming (the
      // sentinel never left and re-entered the zone) — wake up when it ends.
      clearLoadMoreRetry();
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        retryPendingRef.current = false;
        requestLoadMoreRef.current();
      }, waitMs + 50);
      return;
    }
    retryPendingRef.current = false;
    nextLoadMoreAtRef.current = Date.now() + LOAD_MORE_COOLDOWN_MS;
    loadMoreRef.current();
  }, [clearLoadMoreRetry, isSentinelInTriggerZone]);

  requestLoadMoreRef.current = requestLoadMore;

  // Infinite scroll: fetch the next page when the sentinel enters the viewport.
  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          requestLoadMoreRef.current();
        }
      },
      { rootMargin: `${LOAD_MORE_TRIGGER_MARGIN_PX}px` }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore]);

  // Clear a pending cooldown re-arm on unmount so a stale timer can't fire a
  // fetch after the album view left the screen.
  useEffect(() => {
    return () => clearLoadMoreRetry();
  }, [clearLoadMoreRetry]);

  // Load the wall posts once when the picker first opens (a wall-size batch,
  // legacy single-query path: an offset disables keyset pagination).
  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    setSelectedIds(new Set(posts.map((p) => p.id)));
    if (pickerPosts.length > 0) return;
    setPickerLoading(true);
    try {
      const res = await fetch(
        `/api/v1/profile_wall_posts?user_id=eq.${profileUserId}&order=created_at.desc&limit=500&offset=0`
      );
      const json = await res.json();
      const raw = (json.data as Record<string, unknown>[]) || [];
      setPickerPosts(raw.map((row) => normalizeWallPostRecord(row, currentUsername)));
    } catch (error) {
      console.error("Error loading wall posts for album picker:", error);
      toast.error(t("profile.threadsLoadError"));
    } finally {
      setPickerLoading(false);
    }
  }, [pickerPosts.length, posts, profileUserId, currentUsername, t]);

  const togglePost = async (postId: string, checked: boolean) => {
    if (pickerBusy) return;
    setPickerBusy(true);
    try {
      if (checked) {
        await onAddPosts([postId]);
        toast.success(t("profile.postsAdded"));
      } else {
        await onRemovePost(postId);
        toast.success(t("profile.postRemoved"));
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (checked) next.add(postId);
        else next.delete(postId);
        return next;
      });
      await loadPosts();
      onAlbumPostsChanged();
    } catch (error) {
      console.error("Error updating album posts:", error);
      toast.error(t("profile.postsAddError"));
    } finally {
      setPickerBusy(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!currentUserId) return;
    try {
      const postToDelete = posts.find((p) => p.id === postId);
      if (postToDelete?.repost_of_post_id) {
        await api
          .from("profile_wall_post_reposts")
          .delete()
          .eq("reposted_wall_post_id", postId)
          .eq("user_id", currentUserId);
      }
      const { error } = await api
        .from("profile_wall_posts")
        .delete()
        .eq("id", postId)
        .or(`author_id.eq.${currentUserId},user_id.eq.${currentUserId}`);
      if (error) throw error;
      toast.success(t("thread.postDeleted"));
      await loadPosts();
      onAlbumPostsChanged();
    } catch (error) {
      console.error("Error deleting post:", error);
      toast.error(t("thread.postDeleteError"));
    }
  };

  const handleTogglePin = async (postId: string) => {
    if (!currentUserId) {
      toast.error(t("profile.threadsLoadError"));
      return;
    }
    try {
      const { data, error } = await api.rpc("toggle_wall_post_pin", {
        _post_id: postId,
        _user_id: currentUserId,
      });
      if (error) throw error;
      if (!data) {
        toast.error(t("profile.threadsLoadError"));
        return;
      }
      await loadPosts();
    } catch (error) {
      console.error("Error toggling pin:", error);
      toast.error(t("profile.threadsLoadError"));
    }
  };

  const handlePostUpdated = (updatedPost: WallPost) => {
    setPosts((prev) =>
      prev.map((post) => (post.id === updatedPost.id ? normalizeWallPostRecord(updatedPost as unknown as Record<string, unknown>, currentUsername) : post))
    );
    setEditingPost(null);
  };

  const submitRename = async () => {
    const name = renameValue.trim();
    if (!name) {
      toast.error(t("profile.albumNameRequired"));
      return;
    }
    try {
      await onRenameAlbum(name);
      setRenameOpen(false);
      toast.success(t("profile.albumRenamed"));
    } catch (error) {
      console.error("Error renaming album:", error);
      toast.error(t("profile.albumRenameError"));
    }
  };

  const submitDelete = async () => {
    try {
      await onDeleteAlbum();
      setDeleteOpen(false);
      toast.success(t("profile.albumDeleted"));
    } catch (error) {
      console.error("Error deleting album:", error);
      toast.error(t("profile.albumDeleteError"));
    }
  };

  const activeEditingPost = posts.find((post) => post.id === editingPost);

  return (
    <div className="space-y-4">
      {/* Album header — the name as a real heading (same weight as the other
          profile tab titles), actions grouped on the right. */}
      {isOwnProfile && (
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-xl font-bold">
            {album.name}
          </h2>
          <button
            type="button"
            onClick={openPicker}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-4 text-sm font-medium text-primary transition-colors hover:border-primary/60 hover:bg-primary/10"
            title={t("profile.addPosts")}
          >
            <Plus className="h-4 w-4" />
            {t("profile.addPosts")}
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:bg-transparent"
                title={t("profile.editAlbum")}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover border-border shadow-lg">
              <DropdownMenuItem
                onClick={() => {
                  setRenameValue(album.name);
                  setRenameOpen(true);
                }}
                className="cursor-pointer hover:bg-primary/15 hover:text-primary focus:bg-primary/15 focus:text-primary transition-colors px-3 py-2"
                title={t("profile.renameAlbum")}
              >
                <Pencil className="h-4 w-4 mr-3" />
                {t("profile.renameAlbum")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDeleteOpen(true)}
                className="cursor-pointer text-destructive hover:bg-destructive/15 hover:text-destructive focus:bg-destructive/15 focus:text-destructive transition-colors px-3 py-2"
                title={t("profile.deleteAlbum")}
              >
                <Trash2 className="h-4 w-4 mr-3" />
                {t("profile.deleteAlbum")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <PentagramLoader size="lg" />
        </div>
      ) : posts.length === 0 ? (
        <div className="border border-dashed border-border/70 bg-muted/20 py-12 text-center">
          <p className="text-lg font-medium">{t("profile.noAlbumPosts")}</p>
          {isOwnProfile && (
            <p className="mt-2 text-sm text-muted-foreground">{t("profile.noAlbumPostsHint")}</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post, index) => (
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
              forceCommentsOpen={false}
              postHref={getWallPostPath(post.user_id, post.id)}
              standalone={false}
              onImageClick={(items, idx) => {
                setGalleryItems(items);
                setGalleryIndex(idx);
              }}
            />
          ))}
          {hasMore && (
            <div
              ref={sentinelRef}
              data-testid="album-sentinel"
              className="flex justify-center py-4"
            >
              {loadingMore && (
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
              )}
            </div>
          )}
        </div>
      )}

      {/* Add/remove posts picker */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("profile.selectPosts")}</DialogTitle>
            <DialogDescription>{t("profile.selectPostsHint")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto space-y-1 pr-1">
            {pickerLoading ? (
              <div className="flex justify-center py-8">
                <PentagramLoader size="lg" />
              </div>
            ) : pickerPosts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("profile.noPostsToSelect")}
              </p>
            ) : (
              pickerPosts.map((post) => {
                const checked = selectedIds.has(post.id);
                return (
                  <button
                    key={post.id}
                    type="button"
                    disabled={pickerBusy}
                    onClick={() => togglePost(post.id, !checked)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
                      checked
                        ? "border-primary/40 bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      }`}
                    >
                      {checked && <Check className="h-3.5 w-3.5" />}
                    </span>
                    {post.attachments?.[0] && (
                      <img
                        src={storageUrl("content", post.attachments[0].url) || post.attachments[0].url}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-md object-cover"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {post.title || post.content || post.author?.username || "—"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("profile.renameAlbum")}</DialogTitle>
          </DialogHeader>
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
            placeholder={t("profile.albumNamePlaceholder")}
            maxLength={80}
            autoFocus
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submitRename}>{t("common.save")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("profile.deleteAlbum")}</DialogTitle>
            <DialogDescription>
              {t("profile.deleteAlbumConfirm", { name: album.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={submitDelete}>
              {t("common.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

      {!!galleryItems && (
        <Lightbox
          items={galleryItems}
          initialIndex={galleryIndex}
          onClose={() => setGalleryItems(null)}
        />
      )}
    </div>
  );
}
