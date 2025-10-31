import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

interface Board {
  id: string;
  name: string;
  description: string;
}

interface Thread {
  id: string;
  title: string;
  content: string;
  image_url: string | null;
  created_at: string;
  post_count: number;
  profiles: {
    username: string;
  } | null;
}

const Board = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [user, setUser] = useState<any>(null);
  const [showNewThread, setShowNewThread] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
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
      const threadsWithProfiles = await Promise.all(
        threadsData.map(async (thread) => {
          const { data: profile } = await supabase
            .from("profiles")
            .select("username")
            .eq("id", thread.user_id!)
            .maybeSingle();
          
          return {
            ...thread,
            profiles: profile,
          };
        })
      );
      setThreads(threadsWithProfiles);
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

    setLoading(true);

    const { error } = await supabase.from("threads").insert({
      board_id: board!.id,
      user_id: user.id,
      title: title.trim(),
      content: content.trim(),
    });

    setLoading(false);

    if (error) {
      toast.error("Ошибка создания треда");
      return;
    }

    toast.success("Тред создан");
    setTitle("");
    setContent("");
    setShowNewThread(false);
    loadThreads(board!.id);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
  };

  if (!board) return <div className="p-4">Загрузка...</div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <Link to="/" className="text-xl font-bold hover:underline">
              6gomo
            </Link>
            <span className="mx-2">/</span>
            <span className="text-lg">{board.name}</span>
          </div>
          <div className="flex gap-2 items-center">
            {user ? (
              <>
                <span className="text-sm">anon</span>
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

        {user && !showNewThread && (
          <Button onClick={() => setShowNewThread(true)} className="mb-4">
            Создать тред
          </Button>
        )}

        {showNewThread && (
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
            <div className="flex gap-2">
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
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-bold text-lg">{thread.title}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                    {thread.content}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground ml-4 text-right">
                  <div>{thread.post_count} ответов</div>
                  <div>
                    {formatDistanceToNow(new Date(thread.created_at), {
                      locale: ru,
                      addSuffix: true,
                    })}
                  </div>
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
