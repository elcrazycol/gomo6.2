import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Board {
  id: string;
  slug: string;
  name: string;
  description: string;
}

const Index = () => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [user, setUser] = useState<any>(null);
  const navigate = useNavigate();

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
    const loadBoards = async () => {
      const { data } = await supabase
        .from("boards")
        .select("*")
        .order("created_at", { ascending: true });

      if (data) setBoards(data);
    };

    loadBoards();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-board-header text-board-header-foreground p-4 border-b border-border">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-3xl font-bold">6gomo</h1>
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

      <main className="max-w-4xl mx-auto p-6">
        <div className="text-center mb-8">
          <h2 className="text-4xl font-bold mb-2">Добро пожаловать на 6gomo</h2>
          <p className="text-muted-foreground">Имаджборд в стиле 4chan/dvach</p>
        </div>

        <div className="bg-card border border-border p-6 mb-6">
          <h3 className="text-xl font-bold mb-4">Доски</h3>
          <div className="space-y-3">
            {boards.map((board) => (
              <Link
                key={board.id}
                to={`/${board.slug}`}
                className="block p-4 border border-border hover:bg-thread-hover transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-lg font-bold text-primary">{board.name}</h4>
                    <p className="text-sm text-muted-foreground">{board.description}</p>
                  </div>
                  <div className="text-link">→</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-post-header border border-border p-4 text-center text-sm text-muted-foreground">
          <p>© 2025 6gomo · Имаджборд</p>
        </div>
      </main>
    </div>
  );
};

export default Index;
