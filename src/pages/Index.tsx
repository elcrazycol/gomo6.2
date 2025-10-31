import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { NotificationBell } from "@/components/NotificationBell";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface Board {
  id: string;
  slug: string;
  name: string;
  description: string;
}

interface RandomThread {
  id: string;
  title: string;
  board_id: string;
  boards: {
    slug: string;
  };
}

const Index = () => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [randomBoards, setRandomBoards] = useState<Board[]>([]);
  const [randomThread, setRandomThread] = useState<RandomThread | null>(null);
  const navigate = useNavigate();

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
    const loadBoards = async () => {
      const { data } = await supabase
        .from("boards")
        .select("*")
        .eq("is_rules_board", false)
        .order("created_at", { ascending: true });

      if (data) {
        setBoards(data);
        
        // Get 2 random boards
        const shuffled = [...data].sort(() => 0.5 - Math.random());
        setRandomBoards(shuffled.slice(0, 2));
      }
    };

    const loadRandomThread = async () => {
      const { data } = await supabase
        .from("threads")
        .select(`
          id,
          title,
          board_id,
          boards!inner(slug)
        `)
        .limit(100);

      if (data && data.length > 0) {
        const randomIndex = Math.floor(Math.random() * data.length);
        setRandomThread(data[randomIndex]);
      }
    };

    loadBoards();
    loadRandomThread();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-board-header text-board-header-foreground p-3 sm:p-4 border-b border-border">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <h1 className="text-2xl sm:text-3xl font-bold">6gomo</h1>
          <div className="flex gap-1 sm:gap-2 items-center flex-wrap">
            {user && <NotificationBell userId={user.id} />}
            {user ? (
              <>
                <Link to={`/profile/${user.id}`}>
                  <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Профиль</Button>
                </Link>
                {isModerator && (
                  <Link to="/moderation">
                    <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Модерация</Button>
                  </Link>
                )}
                <Button variant="secondary" size="sm" onClick={handleLogout} className="text-xs sm:text-sm">
                  Выйти
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => navigate("/auth")} className="text-xs sm:text-sm">
                Войти
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-3 sm:p-6">
        <div className="text-center mb-6 sm:mb-8">
          <h2 className="text-2xl sm:text-4xl font-bold mb-2">Добро пожаловать на 6gomo</h2>
        </div>

        <div className="mb-4 text-center">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Что такое 6gomo?</Button>
            </DialogTrigger>
            <DialogContent className="bg-background border-border">
              <DialogHeader>
                <DialogTitle>О проекте 6gomo</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p>6gomo - это современная имаджборда, вдохновлённая классическими форумами.</p>
                <p>Здесь вы можете:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Создавать треды и общаться с другими пользователями</li>
                  <li>Загружать изображения к постам</li>
                  <li>Зарабатывать достижения за активность</li>
                  <li>Использовать режим анонимности</li>
                  <li>Получать уведомления об ответах</li>
                </ul>
                <p className="mt-4">
                  <Link to="/rules" className="text-link hover:underline">
                    Ознакомьтесь с правилами →
                  </Link>
                </p>
              </div>
            </DialogContent>
          </Dialog>
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
                    <h4 className="text-lg font-bold text-primary">/{board.slug}/</h4>
                    <p className="text-base font-semibold">{board.name}</p>
                    <p className="text-sm text-muted-foreground">{board.description}</p>
                  </div>
                  <div className="text-link">→</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border p-6 mb-6">
          <h3 className="text-xl font-bold mb-4">Случайность</h3>
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2">Случайные доски:</h4>
              <div className="space-y-2">
                {randomBoards.map((board) => (
                  <Link
                    key={board.id}
                    to={`/${board.slug}`}
                    className="block p-3 border border-border hover:bg-thread-hover transition-colors"
                  >
                    <div className="font-bold text-primary">/{board.slug}/ - {board.name}</div>
                  </Link>
                ))}
              </div>
            </div>
            
            {randomThread && (
              <div>
                <h4 className="font-semibold mb-2">Случайный тред:</h4>
                <Link
                  to={`/${randomThread.boards.slug}/thread/${randomThread.id}`}
                  className="block p-3 border border-border hover:bg-thread-hover transition-colors"
                >
                  <div className="font-bold">{randomThread.title}</div>
                </Link>
              </div>
            )}
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
