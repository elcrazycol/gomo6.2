import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { ImageUpload } from "@/components/ImageUpload";
import { UserBadge } from "@/components/UserBadge";
import { NotificationBell } from "@/components/NotificationBell";

interface Board {
  id: string;
  name: string;
  description: string;
  is_rules_board: boolean;
}

interface Thread {
  id: string;
  title: string;
  content: string;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  post_count: number;
  user_id: string | null;
  profiles: {
    username: string;
    is_anonymous: boolean;
  } | null;
  latest_post?: {
    content: string;
    created_at: string;
  };
}

const Board = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [showNewThread, setShowNewThread] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
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
        
        setIsModerator(roles?.some(r => r.role === 'moderator' || r.role === 'admin') || false);
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
    const loadBoard = async () => {
      const { data: boardData } = await supabase
        .from("boards")
        .select("*")
        .eq("slug", slug)
        .single();

      if (boardData) {
        setBoard(boardData);
        loadThreads(boardData.id);
      }
    };

    loadBoard();
  }, [slug]);

  const loadThreads = async (boardId: string) => {
    const { data: threadsData } = await supabase
      .from("threads")
      .select("*")
      .eq("board_id", boardId)
      .order("updated_at", { ascending: false });

    if (threadsData) {
      const threadsWithData = await Promise.all(
        threadsData.map(async (thread) => {
          const { data: profile } = await supabase
            .from("profiles")
            .select("username, is_anonymous")
            .eq("id", thread.user_id!)
            .maybeSingle();
          
          // Get latest post
          const { data: latestPost } = await supabase
            .from("posts")
            .select("content, created_at")
            .eq("thread_id", thread.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          return {
            ...thread,
            profiles: profile,
            latest_post: latestPost,
          };
        })
      );
      setThreads(threadsWithData);
    }
  };

  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast.error("Нужно войти для создания треда");
      navigate("/auth");
      return;
    }

    if (!title.trim() || !content.trim()) {
      toast.error("Заполните все поля");
      return;
    }

    // Check if it's a rules board and user has permissions
    if (board?.is_rules_board && !isModerator) {
      toast.error("Только модераторы могут создавать треды здесь");
      return;
    }

    setLoading(true);

    const { error } = await supabase.from("threads").insert({
      board_id: board!.id,
      user_id: user.id,
      title: title.trim(),
      content: content.trim(),
      image_url: imageUrl,
    });

    setLoading(false);

    if (error) {
      toast.error("Ошибка создания треда");
      return;
    }

    toast.success("Тред создан");
    setTitle("");
    setContent("");
    setImageUrl(null);
    setShowNewThread(false);
    loadThreads(board!.id);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
  };

  if (!board) return <div className="p-4">Загрузка...</div>;

  const canCreateThread = user && (!board.is_rules_board || isModerator);

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <Link to="/" className="text-xl font-bold hover:underline">
              6gomo
            </Link>
            <span className="mx-2">/</span>
            <span className="text-lg">/{slug}/ - {board.name}</span>
          </div>
          <div className="flex gap-2 items-center">
            {user && <NotificationBell userId={user.id} />}
            {user ? (
              <>
                <Link to={`/profile/${user.id}`}>
                  <Button variant="ghost" size="sm">Профиль</Button>
                </Link>
                {isModerator && (
                  <Link to="/moderation">
                    <Button variant="ghost" size="sm">Модерация</Button>
                  </Link>
                )}
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
        <div className="mb-4 text-center">
          <p className="text-muted-foreground">{board.description}</p>
        </div>

        {canCreateThread && !showNewThread && (
          <Button onClick={() => setShowNewThread(true)} className="mb-4">
            Создать тред
          </Button>
        )}

        {showNewThread && canCreateThread && (
          <form onSubmit={handleCreateThread} className="bg-post-header p-4 border border-border mb-4">
            <h3 className="font-bold mb-2">Новый тред</h3>
            <Input
              placeholder="Тема"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mb-2"
              disabled={loading}
            />
            <Textarea
              placeholder="Сообщение"
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
            <div className="flex gap-2 mt-3">
              <Button type="submit" disabled={loading}>
                {loading ? "Отправка..." : "Отправить"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowNewThread(false)}
                disabled={loading}
              >
                Отмена
              </Button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          {threads.map((thread) => (
            <Link
              key={thread.id}
              to={`/${slug}/thread/${thread.id}`}
              className="block border border-border bg-card p-3 hover:bg-thread-hover transition-colors"
            >
              <div className="flex gap-3">
                {thread.image_url && (
                  <img
                    src={thread.image_url}
                    alt="Thread"
                    className="w-20 h-20 object-cover border border-border flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-lg">{thread.title}</h3>
                  <div className="text-xs text-muted-foreground mb-1">
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
                  {thread.latest_post ? (
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                      Последний: {thread.latest_post.content.substring(0, 100)}...
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                      {thread.content.substring(0, 100)}...
                    </p>
                  )}
                </div>
                <div className="text-xs text-muted-foreground text-right flex-shrink-0">
                  <div className="font-bold">{thread.post_count} ответов</div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {threads.length === 0 && (
          <div className="text-center text-muted-foreground p-8">
            Тредов пока нет. Будьте первым!
          </div>
        )}
      </main>
    </div>
  );
};

export default Board;
