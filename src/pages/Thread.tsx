import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { ImageUpload } from "@/components/ImageUpload";
import { UserBadge } from "@/components/UserBadge";
import { NotificationBell } from "@/components/NotificationBell";
import { AlertTriangle, Reply } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Thread {
  id: string;
  title: string;
  content: string;
  image_url: string | null;
  created_at: string;
  user_id: string | null;
  profiles: {
    username: string;
    is_anonymous: boolean;
  } | null;
  boards: {
    slug: string;
    name: string;
    is_rules_board: boolean;
  };
}

interface Post {
  id: string;
  content: string;
  image_url: string | null;
  created_at: string;
  user_id: string | null;
  reply_to: string | null;
  profiles: {
    username: string;
    is_anonymous: boolean;
  } | null;
}

const Thread = () => {
  const { slug, threadId } = useParams();
  const navigate = useNavigate();
  const [thread, setThread] = useState<Thread | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportingPost, setReportingPost] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      
      if (session?.user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id);
        
        setIsAdmin(roles?.some(r => r.role === 'admin') || false);
      }
    };
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    loadThread();
    loadPosts();
  }, [threadId]);

  useEffect(() => {
    // Set up realtime subscription for new posts
    const channel = supabase
      .channel(`thread-${threadId}-posts`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'posts',
          filter: `thread_id=eq.${threadId}`,
        },
        () => {
          loadPosts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId]);

  const loadThread = async () => {
    const { data: threadData } = await supabase
      .from("threads")
      .select("*")
      .eq("id", threadId)
      .single();

    if (threadData) {
      const { data: board } = await supabase
        .from("boards")
        .select("slug, name, is_rules_board")
        .eq("id", threadData.board_id)
        .single();

      const { data: profile } = await supabase
        .from("profiles")
        .select("username, is_anonymous")
        .eq("id", threadData.user_id!)
        .maybeSingle();

      setThread({
        ...threadData,
        boards: board!,
        profiles: profile,
      });
    }
  };

  const loadPosts = async () => {
    const { data: postsData } = await supabase
      .from("posts")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (postsData) {
      const postsWithProfiles = await Promise.all(
        postsData.map(async (post) => {
          const { data: profile } = await supabase
            .from("profiles")
            .select("username, is_anonymous")
            .eq("id", post.user_id!)
            .maybeSingle();
          
          return {
            ...post,
            profiles: profile,
          };
        })
      );
      setPosts(postsWithProfiles);
    }
  };

  const handleSubmitPost = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast.error("Нужно войти для ответа");
      navigate("/auth");
      return;
    }

    if (!content.trim()) {
      toast.error("Напишите что-нибудь");
      return;
    }

    // Check if only admin can post (rules board)
    if (thread?.boards.is_rules_board && !isAdmin) {
      toast.error("Только администраторы могут писать на этой доске");
      return;
    }

    setLoading(true);

    const { error } = await supabase.from("posts").insert({
      thread_id: threadId,
      user_id: user.id,
      content: content.trim(),
      image_url: imageUrl,
      reply_to: replyingTo,
    });

    setLoading(false);

    if (error) {
      toast.error("Ошибка отправки");
      return;
    }

    setContent("");
    setImageUrl(null);
    setReplyingTo(null);
  };

  const handleReport = async (postId: string | null, isThread: boolean) => {
    if (!user) {
      toast.error("Нужно войти для отправки жалоб");
      return;
    }

    if (!reportReason.trim()) {
      toast.error("Укажите причину жалобы");
      return;
    }

    const { error } = await supabase.from("reports").insert({
      reporter_id: user.id,
      reported_post_id: isThread ? null : postId,
      reported_thread_id: isThread ? threadId : null,
      reason: reportReason.trim(),
    });

    if (error) {
      toast.error("Ошибка отправки жалобы");
    } else {
      toast.success("Жалоба отправлена");
      setReportReason("");
      setReportingPost(null);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
  };

  if (!thread) return <div className="p-4">Загрузка...</div>;

  const canPost = user && (!thread.boards.is_rules_board || isAdmin);

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <Link to="/" className="text-xl font-bold hover:underline">
              6gomo
            </Link>
            <span className="mx-2">/</span>
            <Link to={`/${slug}`} className="hover:underline">
              /{slug}/ - {thread.boards.name}
            </Link>
          </div>
          <div className="flex gap-2 items-center">
            {user && <NotificationBell userId={user.id} />}
            {user ? (
              <>
                <Link to={`/profile/${user.id}`}>
                  <Button variant="ghost" size="sm">Профиль</Button>
                </Link>
                <Button variant="secondary" size="sm" onClick={handleLogout}>
                  Выйти
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => navigate("/auth")}>
                Войти
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4">
        <div className="mb-4">
          <Link to={`/${slug}`} className="text-link hover:underline text-sm">
            ← Назад к доске
          </Link>
        </div>

        <div className="border border-border bg-card p-4 mb-4">
          <div className="flex justify-between items-start mb-2">
            <h1 className="text-2xl font-bold">{thread.title}</h1>
            {user && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <AlertTriangle className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-background border-border">
                  <DialogHeader>
                    <DialogTitle>Пожаловаться на тред</DialogTitle>
                  </DialogHeader>
                  <Textarea
                    placeholder="Причина жалобы..."
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    rows={3}
                  />
                  <Button onClick={() => handleReport(null, true)}>
                    Отправить жалобу
                  </Button>
                </DialogContent>
              </Dialog>
            )}
          </div>
          
          <div className="bg-post-header p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-2">
              <span className="font-mono text-primary">#{thread.id.slice(0, 8)}</span>
              {" · "}
              <UserBadge
                userId={thread.user_id}
                username={thread.profiles?.username || "Аноним"}
                isAnonymous={thread.profiles?.is_anonymous}
              />
              {" · "}
              {formatDistanceToNow(new Date(thread.created_at), {
                locale: ru,
                addSuffix: true,
              })}
            </div>
            {thread.image_url && (
              <img
                src={thread.image_url}
                alt="Thread image"
                className="max-w-md max-h-96 mb-2 border border-border"
              />
            )}
            <p className="whitespace-pre-wrap">{thread.content}</p>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          {posts.map((post) => (
            <div
              key={post.id}
              id={`post-${post.id}`}
              className="bg-post-header p-3 border border-border"
            >
              <div className="flex justify-between items-start">
                <div className="text-xs text-muted-foreground mb-2">
                  <span className="font-mono text-primary">#{post.id.slice(0, 8)}</span>
                  {" · "}
                  <UserBadge
                    userId={post.user_id}
                    username={post.profiles?.username || "Аноним"}
                    isAnonymous={post.profiles?.is_anonymous}
                  />
                  {" · "}
                  {formatDistanceToNow(new Date(post.created_at), {
                    locale: ru,
                    addSuffix: true,
                  })}
                </div>
                <div className="flex gap-1">
                  {user && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setReplyingTo(post.id)}
                      >
                        <Reply className="h-4 w-4" />
                      </Button>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setReportingPost(post.id)}
                          >
                            <AlertTriangle className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-background border-border">
                          <DialogHeader>
                            <DialogTitle>Пожаловаться на пост</DialogTitle>
                          </DialogHeader>
                          <Textarea
                            placeholder="Причина жалобы..."
                            value={reportReason}
                            onChange={(e) => setReportReason(e.target.value)}
                            rows={3}
                          />
                          <Button onClick={() => handleReport(post.id, false)}>
                            Отправить жалобу
                          </Button>
                        </DialogContent>
                      </Dialog>
                    </>
                  )}
                </div>
              </div>
              {post.reply_to && (
                <a
                  href={`#post-${post.reply_to}`}
                  className="text-xs text-link hover:underline block mb-1"
                >
                  → Ответ на #{post.reply_to.slice(0, 8)}
                </a>
              )}
              {post.image_url && (
                <img
                  src={post.image_url}
                  alt="Post image"
                  className="max-w-md max-h-96 mb-2 border border-border"
                />
              )}
              <p className="whitespace-pre-wrap">{post.content}</p>
            </div>
          ))}
        </div>

        {canPost ? (
          <form onSubmit={handleSubmitPost} className="bg-post-header p-4 border border-border sticky bottom-4">
            <h3 className="font-bold mb-2">
              {replyingTo ? `Ответ на #${replyingTo.slice(0, 8)}` : "Ответить"}
            </h3>
            {replyingTo && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setReplyingTo(null)}
                className="mb-2"
              >
                Отменить ответ
              </Button>
            )}
            <Textarea
              placeholder="Напишите ответ..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="mb-2"
              rows={4}
              disabled={loading}
            />
            <ImageUpload
              onImageUploaded={setImageUrl}
              currentImage={imageUrl}
              onRemove={() => setImageUrl(null)}
            />
            <Button type="submit" disabled={loading} className="mt-2">
              {loading ? "Отправка..." : "Отправить"}
            </Button>
          </form>
        ) : user ? (
          <div className="bg-post-header p-4 border border-border text-center">
            <p className="mb-2">На этой доске могут писать только администраторы</p>
          </div>
        ) : (
          <div className="bg-post-header p-4 border border-border text-center">
            <p className="mb-2">Войдите, чтобы ответить</p>
            <Button onClick={() => navigate("/auth")}>Войти</Button>
          </div>
        )}
      </main>
    </div>
  );
};

export default Thread;
