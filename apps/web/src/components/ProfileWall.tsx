import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CreateWallPost, type WallPost } from "@/components/CreateWallPost";
import { ImageGallery } from "@/components/ImageGallery";
import { MediaPlayer } from "@/components/MediaPlayer";
import { ProcessedContent } from "@/components/ProcessedContent";
import { UserBadge } from "@/components/UserBadge";
import { AttachmentMeta } from "@/types/forum";
import { Edit3, FileText, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface ProfileWallProps {
  profileUserId: string;
  currentUserId: string | null;
  currentUsername: string;
  canPost: boolean;
  showWall: boolean;
}

const normalizeAttachments = (post: WallPost): AttachmentMeta[] => {
  if (Array.isArray(post.attachments) && post.attachments.length > 0) {
    return post.attachments;
  }
  if (post.image_url) {
    return [{
      url: post.image_url,
      type: "image",
      mime: "image/*",
      name: "wall-image",
      size: 0,
    }];
  }
  return [];
};

const WallAttachments = ({
  attachments,
  onImageClick,
  galleryKey,
}: {
  attachments: AttachmentMeta[];
  onImageClick: (images: string[], index: number) => void;
  galleryKey: string;
}) => {
  const imageUrls = attachments.filter((attachment) => attachment.type === "image").map((attachment) => attachment.url);

  return (
    <div className="space-y-3">
      {imageUrls.length > 1 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {imageUrls.map((url, index) => (
            <button
              key={url}
              type="button"
              className="overflow-hidden rounded-3xl border border-border/60 bg-muted/40"
              onClick={() => onImageClick(imageUrls, index)}
            >
              <img src={url} alt={`attachment-${index + 1}`} className="h-40 w-full object-cover transition-transform hover:scale-[1.02]" />
            </button>
          ))}
        </div>
      )}

      {attachments.map((attachment, index) => {
        if (attachment.type === "image" && imageUrls.length > 1) return null;

        if (attachment.type === "image") {
          return (
            <button
              key={`${galleryKey}-${index}`}
              type="button"
              className="block overflow-hidden rounded-3xl border border-border/60 bg-muted/40"
              onClick={() => onImageClick(imageUrls, 0)}
            >
              <img src={attachment.url} alt={attachment.name || "attachment"} className="max-h-[32rem] w-full object-cover" />
            </button>
          );
        }

        if (attachment.type === "video") {
          return (
            <MediaPlayer
              key={`${galleryKey}-${index}`}
              kind="video"
              poster={attachment.poster}
              sources={[{ src: attachment.url, type: attachment.mime || "video/webm" }]}
              className="max-w-3xl"
            />
          );
        }

        if (attachment.type === "audio") {
          return (
            <MediaPlayer
              key={`${galleryKey}-${index}`}
              kind="audio"
              sources={[{ src: attachment.url, type: attachment.mime || "audio/ogg" }]}
              className="max-w-xl"
              playerId={`wall-audio-${galleryKey}-${index}`}
              title={attachment.name || "Аудио"}
              playlistId={`wall-${galleryKey}`}
              playlistIndex={index}
            />
          );
        }

        return (
          <a
            key={`${galleryKey}-${index}`}
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-2xl border border-border/60 bg-background/80 px-3 py-2 text-sm text-primary"
          >
            <FileText className="h-4 w-4" />
            <span className="max-w-[18rem] truncate">{attachment.name || attachment.url}</span>
          </a>
        );
      })}
    </div>
  );
};

export const ProfileWall = ({
  profileUserId,
  currentUserId,
  currentUsername,
  canPost,
  showWall,
}: ProfileWallProps) => {
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [galleryImages, setGalleryImages] = useState<string[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  useEffect(() => {
    if (showWall) {
      loadPosts();
    }
  }, [profileUserId, showWall]);

  const loadPosts = async () => {
    try {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from("profile_wall_posts")
        .select(`
          id,
          user_id,
          author_id,
          title,
          content,
          image_url,
          attachments,
          created_at,
          updated_at,
          is_pinned,
          pinned_order,
          author:profiles!author_id (
            username,
            is_anonymous,
            avatar_url
          )
        `)
        .eq("user_id", profileUserId)
        .order("is_pinned", { ascending: false })
        .order("pinned_order", { ascending: true })
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPosts((data || []) as WallPost[]);
    } catch (error) {
      console.error("Error loading wall posts:", error);
      toast.error("Ошибка загрузки постов стены");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!currentUserId) return;

    try {
      const { error } = await supabase
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
    if (!currentUserId) return;

    try {
      const { data, error } = await supabase.rpc("toggle_wall_post_pin", {
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
    setPosts((prev) => [newPost, ...prev]);
    setShowCreateForm(false);
  };

  const handlePostUpdated = (updatedPost: WallPost) => {
    setPosts((prev) => prev.map((post) => (post.id === updatedPost.id ? updatedPost : post)));
    setEditingPost(null);
  };

  const pinnedPost = useMemo(() => posts.find((post) => post.is_pinned), [posts]);

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
        <div className="rounded-[2rem] border border-border/70 bg-gradient-to-br from-background via-background to-muted/35 p-4 shadow-sm sm:p-5">
          <div className="flex justify-end">
            {canPost && (
              <Button
                variant="default"
                size="icon"
                onClick={() => {
                  setEditingPost(null);
                  setShowCreateForm((prev) => !prev);
                }}
                className="h-12 w-12 rounded-2xl text-xl shadow-sm transition-all duration-300"
                title={showCreateForm ? "Скрыть форму" : "Написать на стене"}
              >
                <Plus className={`h-5 w-5 transition-transform duration-300 ${showCreateForm ? "rotate-45" : "rotate-0"}`} />
              </Button>
            )}
          </div>

          {pinnedPost && !showCreateForm && (
            <div className="mt-4 rounded-3xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
              Закреплено: <span className="font-medium text-foreground">{pinnedPost.title}</span>
            </div>
          )}
        </div>

        <div
          className={`grid transition-all duration-300 ease-out ${
            showCreateForm && currentUserId ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            {showCreateForm && currentUserId && (
              <CreateWallPost
                profileUserId={profileUserId}
                currentUserId={currentUserId}
                onPostCreated={handlePostCreated}
                onCancel={() => setShowCreateForm(false)}
              />
            )}
          </div>
        </div>

        {posts.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-border/70 bg-muted/20 py-12 text-center">
            <p className="text-lg font-medium">На стене пока тихо</p>
            {canPost && <p className="mt-2 text-sm text-muted-foreground">Нажмите `+`, чтобы оставить первую запись.</p>}
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => {
              const attachments = normalizeAttachments(post);
              const canManage = currentUserId === post.author_id || currentUserId === post.user_id;

              return (
                <Card
                  key={post.id}
                  className={`overflow-hidden rounded-[2rem] border-border/70 shadow-sm ${
                    post.is_pinned ? "border-primary/30 bg-gradient-to-br from-primary/5 via-background to-background" : "bg-background/95"
                  }`}
                >
                  <CardContent className="space-y-4 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <UserBadge
                              userId={post.author_id}
                              username={post.author.username}
                              isAnonymous={post.author.is_anonymous}
                              avatarUrl={post.author.avatar_url}
                              currentUsername={currentUsername}
                            />
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(post.created_at), {
                                locale: ru,
                                addSuffix: true,
                              })}
                            </span>
                            {post.is_pinned && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                                <Pin className="h-3.5 w-3.5" />
                                Закреплено
                              </span>
                            )}
                          </div>

                          {post.content && (
                            <div className="mt-3 break-words text-[15px] leading-7">
                              <ProcessedContent content={post.content} />
                            </div>
                          )}
                        </div>
                      </div>

                      {canManage && (
                        <div className="flex shrink-0 items-center gap-1">
                          {currentUserId === post.user_id && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleTogglePin(post.id)}
                              className="h-9 w-9 rounded-full"
                              title={post.is_pinned ? "Открепить пост" : "Закрепить пост"}
                            >
                              {post.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                            </Button>
                          )}

                          {currentUserId === post.author_id && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEditingPost(post.id)}
                              className="h-9 w-9 rounded-full"
                              title="Редактировать"
                            >
                              <Edit3 className="h-4 w-4" />
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeletePost(post.id)}
                            className="h-9 w-9 rounded-full text-destructive hover:text-destructive"
                            title="Удалить"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {attachments.length > 0 && (
                      <WallAttachments
                        attachments={attachments}
                        galleryKey={post.id}
                        onImageClick={(images, index) => {
                          setGalleryImages(images);
                          setGalleryIndex(index);
                        }}
                      />
                    )}

                    {editingPost === post.id && currentUserId && (
                      <CreateWallPost
                        profileUserId={profileUserId}
                        currentUserId={currentUserId}
                        editingPost={post}
                        onPostUpdated={handlePostUpdated}
                        onCancel={() => setEditingPost(null)}
                      />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {galleryImages && (
        <ImageGallery
          images={galleryImages}
          initialIndex={galleryIndex}
          onClose={() => setGalleryImages(null)}
        />
      )}
    </>
  );
};
