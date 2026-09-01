import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/profile_album_posts?album_id=eq.${album.id}`);
      const json = await res.json();
      const raw = (json.data as Record<string, unknown>[]) || [];
      setPosts(raw.map((row) => normalizeWallPostRecord(row, currentUsername)));
    } catch (error) {
      console.error("Error loading album posts:", error);
      toast.error(t("profile.threadsLoadError"));
    } finally {
      setLoading(false);
    }
  }, [album.id, currentUsername, t]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

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
      {/* Album header + management (owner only) */}
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xl font-bold flex-1 min-w-0 truncate">
          {album.name}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({album.post_count})
          </span>
        </h2>
        {isOwnProfile && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={openPicker}
              className="gap-1.5"
              title={t("profile.addPosts")}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t("profile.addPosts")}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setRenameValue(album.name);
                setRenameOpen(true);
              }}
              title={t("profile.renameAlbum")}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
              title={t("profile.deleteAlbum")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

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
