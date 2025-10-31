import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

interface Thread {
  id: string;
  title: string;
  content: string;
  image_url: string | null;
  created_at: string;
  profiles: {
    username: string;
  } | null;
  boards: {
    slug: string;
    name: string;
  };
}

interface Post {
  id: string;
  content: string;
  image_url: string | null;
  created_at: string;
  profiles: {
    username: string;
  } | null;
}

const Thread = () => {
  const { slug, threadId } = useParams();
  const navigate = useNavigate();
  const [thread, setThread] = useState<Thread | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [user, setUser] = useState<any>(null);
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
    loadThread();
    loadPosts();

    const channel = supabase
      .channel('posts-changes')
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
        .select("slug, name")
        .eq("id", threadData.board_id)
        .single();

      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
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
            .select("username")
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

    setLoading(true);

    const { error } = await supabase.from("posts").insert({
      thread_id: threadId,
      user_id: user.id,
      content: content.trim(),
    });

    setLoading(false);

    if (error) {
      toast.error("Ошибка отправки");
      return;
    }

    setContent("");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
  };

  if (!thread) return <div className="p-4">Загрузка...</div>;

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
              {thread.boards.name}
            </Link>
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
        <div className="mb-4">
          <Link to={`/${slug}`} className="text-link hover:underline text-sm">
            ← Назад к доске
          </Link>
        </div>

        <div className="border border-border bg-card p-4 mb-4">
          <h1 className="text-2xl font-bold mb-2">{thread.title}</h1>
          <div className="bg-post-header p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-2">
              <span className="font-mono text-primary">#{thread.id.slice(0, 8)}</span>
              {" · "}
              <span className="font-bold text-quote">
                {thread.profiles?.username || "Аноним"}
              </span>
              {" · "}
              {formatDistanceToNow(new Date(thread.created_at), {
                locale: ru,
                addSuffix: true,
              })}
            </div>
            <p className="whitespace-pre-wrap">{thread.content}</p>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          {posts.map((post) => (
            <div key={post.id} className="bg-post-header p-3 border border-border">
              <div className="text-xs text-muted-foreground mb-2">
                <span className="font-mono text-primary">#{post.id.slice(0, 8)}</span>
                {" · "}
                <span className="font-bold text-quote">
                  {post.profiles?.username || "Аноним"}
                </span>
                {" · "}
                {formatDistanceToNow(new Date(post.created_at), {
                  locale: ru,
                  addSuffix: true,
                })}
              </div>
              <p className="whitespace-pre-wrap">{post.content}</p>
            </div>
          ))}
        </div>

        {user ? (
          <form onSubmit={handleSubmitPost} className="bg-post-header p-4 border border-border sticky bottom-4">
            <h3 className="font-bold mb-2">Ответить</h3>
            <Textarea
              placeholder="Напишите ответ..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="mb-2"
              rows={4}
              disabled={loading}
            />
            <Button type="submit" disabled={loading}>
              {loading ? "Отправка..." : "Отправить"}
            </Button>
          </form>
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
