import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ProcessedContent } from "@/components/ProcessedContent";
import { UserBadge } from "@/components/UserBadge";
import { Plus, Trash2, Edit3, Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { CreateWallPost } from "./CreateWallPost";

interface WallPost {
  id: string;
  user_id: string;
  author_id: string;
  title: string;
  content: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  is_pinned: boolean;
  pinned_order?: number | null;
  author: {
    username: string;
    is_anonymous: boolean;
    avatar_url?: string | null;
  };
}

interface ProfileWallProps {
  profileUserId: string;
  currentUserId: string | null;
  currentUsername: string;
  canPost: boolean;
  showWall: boolean;
}

export const ProfileWall: React.FC<ProfileWallProps> = ({
  profileUserId,
  currentUserId,
  currentUsername,
  canPost,
  showWall
}) => {
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingPost, setEditingPost] = useState<string | null>(null);

  useEffect(() => {
    if (showWall) {
      loadPosts();
    }
  }, [profileUserId, showWall]);

  const loadPosts = async () => {
    try {
      const { data, error } = await supabase
        .from("profile_wall_posts")
        .select(`
          id,
          user_id,
          author_id,
          title,
          content,
          image_url,
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

      setPosts(data || []);
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

      setPosts(prev => prev.filter(p => p.id !== postId));
      toast.success("Пост удален");
    } catch (error) {
      console.error("Error deleting post:", error);
      toast.error("Ошибка удаления поста");
    }
  };

  const handleTogglePin = async (postId: string) => {
    if (!currentUserId) return;

    try {
      const { data, error } = await supabase.rpc('toggle_wall_post_pin', {
        _post_id: postId,
        _user_id: currentUserId
      });

      if (error) throw error;

      if (data) {
        // Reload posts to reflect changes
        await loadPosts();
        toast.success("Статус закрепления изменен");
      } else {
        toast.error("У вас нет прав на закрепление этого поста");
      }
    } catch (error) {
      console.error("Error toggling pin:", error);
      toast.error("Ошибка изменения закрепления");
    }
  };


  const handlePostCreated = (newPost: WallPost) => {
    setPosts(prev => [newPost, ...prev]);
    setShowCreateForm(false);
  };

  const handlePostUpdated = (updatedPost: WallPost) => {
    setPosts(prev => prev.map(p => p.id === updatedPost.id ? updatedPost : p));
    setEditingPost(null);
  };

  if (!showWall) {
    return null;
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse">
          <div className="h-4 bg-muted rounded w-48 mb-4"></div>
          <div className="space-y-3">
            <div className="h-32 bg-muted rounded"></div>
            <div className="h-32 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canPost && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Написать на стене
          </Button>
        </div>
      )}

      {showCreateForm && (
        <CreateWallPost
          profileUserId={profileUserId}
          currentUserId={currentUserId!}
          onPostCreated={handlePostCreated}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      {posts.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>На стене пока нет постов</p>
          {canPost && (
            <p className="text-sm mt-2">Будьте первым, кто напишет на этой стене!</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <Card key={post.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
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
                          addSuffix: true
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-lg">{post.title}</h4>
                      {post.is_pinned && (
                        <Pin className="w-4 h-4 text-primary" title="Закрепленный пост" />
                      )}
                    </div>
                  </div>

                  {(currentUserId === post.author_id || currentUserId === post.user_id) && (
                    <div className="flex items-center gap-1">
                      {currentUserId === post.user_id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleTogglePin(post.id)}
                          className="h-8 w-8 p-0"
                          title={post.is_pinned ? "Открепить пост" : "Закрепить пост"}
                        >
                          {post.is_pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                        </Button>
                      )}
                      {currentUserId === post.author_id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingPost(post.id)}
                          className="h-8 w-8 p-0"
                        >
                          <Edit3 className="w-3 h-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeletePost(post.id)}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>

              {post.image_url && (
                <div className="px-6 pb-3">
                  <img
                    src={post.image_url}
                    alt={post.title}
                    className="w-full max-w-md rounded-lg"
                  />
                </div>
              )}

              {post.content && (
                <CardContent className="pt-0">
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ProcessedContent content={post.content} />
                  </div>
                </CardContent>
              )}

              {editingPost === post.id && (
                <div className="px-6 pb-4">
                  <CreateWallPost
                    profileUserId={profileUserId}
                    currentUserId={currentUserId!}
                    editingPost={post}
                    onPostUpdated={handlePostUpdated}
                    onCancel={() => setEditingPost(null)}
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};