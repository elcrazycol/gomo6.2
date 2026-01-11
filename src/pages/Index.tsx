import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Settings } from "lucide-react";
import { UserBadge } from "@/components/UserBadge";
import { TermsOfService } from "@/components/TermsOfService";
import { useSessionTime } from "@/hooks/useSessionTime";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Footer } from "@/components/Footer";
import { CookieBanner } from "@/components/CookieBanner";

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

interface PopularThread {
  id: string;
  title: string;
  post_count: number;
  board_id: string;
  boards: {
    slug: string;
    name: string;
  };
}

const Index = () => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [randomBoards, setRandomBoards] = useState<Board[]>([]);
  const [randomThread, setRandomThread] = useState<RandomThread | null>(null);
  const [popularThreads, setPopularThreads] = useState<PopularThread[]>([]);
  const [showTerms, setShowTerms] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  
  useSessionTime(user?.id);

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
        
        // Check if user has accepted terms
        const { data: termsData } = await supabase
          .from("user_terms_acceptance")
          .select("*")
          .eq("user_id", session.user.id)
          .maybeSingle();
        
        if (!termsData) {
          setShowTerms(true);
        } else {
          setTermsAccepted(true);
        }
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

    const loadPopularThreads = async () => {
      const { data } = await supabase
        .from("threads")
        .select(`
          id,
          title,
          post_count,
          board_id,
          boards!inner(slug, name)
        `)
        .order("post_count", { ascending: false })
        .limit(5);

      if (data) {
        setPopularThreads(data);
      }
    };

    const loadAll = async () => {
      setLoading(true);
      await Promise.all([
        loadBoards(),
        loadRandomThread(),
        loadPopularThreads(),
      ]);
      setLoading(false);
    };
    loadAll();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
  };

  const handleAcceptTerms = async () => {
    if (!user) return;
    
    await supabase
      .from("user_terms_acceptance")
      .insert({
        user_id: user.id,
      });
    
    setShowTerms(false);
    setTermsAccepted(true);
    toast.success("Спасибо за согласие с правилами");
  };

  const handleDeclineTerms = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
    toast.info("Вы покинули сайт");
  };

  if (loading) {
    return (
      <div className="bg-background flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen flex flex-col">
      <div className="flex-1">
        <header className="bg-board-header text-board-header-foreground p-3 sm:p-4 border-b border-border">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
          <img
            src="/photoes/gomo6.png"
            alt="gomo6"
            className="h-4 sm:h-5 md:h-6 w-auto object-contain flex-shrink-0 max-w-[80px] sm:max-w-[100px] md:max-w-[120px]"
          />
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            <Link to="/settings">
              <Button variant="ghost" size="sm" className="p-2">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            {user && <NotificationBell userId={user.id} />}
            {user && <ChatIcon userId={user.id} />}
            {user ? (
              <>
                <div className="hidden sm:flex gap-1 sm:gap-2 items-center">
                  <ProfileHoverCard userId={user.id}>
                    <Link to={`/profile/${user.id}`}>
                      <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Профиль</Button>
                    </Link>
                  </ProfileHoverCard>
                  {isModerator && (
                    <Link to="/moderation">
                      <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Модерация</Button>
                    </Link>
                  )}
                </div>
                <MobileMenu
                  user={user}
                  isModerator={isModerator}
                />
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
        </div>

        <div className="mb-2 text-center">
          <Dialog>
            <DialogTrigger asChild>
              <Link to="/rules">
                <Button variant="outline">Информация</Button>
              </Link>
            </DialogTrigger>
            <DialogContent className="bg-background border-border">
              <DialogHeader>
                <DialogTitle>О проекте gomo6</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p>gomo6 - это современная имиджборда, вдохновлённая классическими форумами.</p>
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
              <>
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
                    <div className="text-primary">→</div>
                  </div>
                </Link>
                {board.slug === 'b' && (
                  <div className="mt-6 pt-4 border-t-2 border-primary">
                    <p className="text-sm font-semibold text-muted-foreground mb-2">Специальные доски:</p>
                  </div>
                )}
              </>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border p-6 mb-6">
          <h3 className="text-xl font-bold mb-4">Популярные треды</h3>
          <div className="space-y-2">
            {popularThreads.map((thread) => (
              <Link
                key={thread.id}
                to={`/${thread.boards.slug}/thread/${thread.id}`}
                className="block p-3 border border-border hover:bg-thread-hover transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-bold">{thread.title}</div>
                    <div className="text-sm text-muted-foreground">
                      /{thread.boards.slug}/ - {thread.boards.name}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground ml-2">
                    {thread.post_count} отв.
                  </div>
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

      </main>


        <TermsOfService
          open={showTerms}
          onAccept={handleAcceptTerms}
          onDecline={handleDeclineTerms}
          canDecline={true}
        />
      </div>

      <div className="mt-auto">
        <Footer />
        <CookieBanner />
      </div>
    </div>
  );
};

export default Index;
