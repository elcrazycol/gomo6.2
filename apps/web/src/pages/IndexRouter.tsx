import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Settings } from "lucide-react";
import { UserBadge } from "@/components/UserBadge";
import { HeaderUsername } from "@/components/HeaderUsername";
import { TermsOfService } from "@/components/TermsOfService";
import { useSessionTime } from "@/hooks/useSessionTime";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Footer } from "@/components/Footer";
import { CookieBanner } from "@/components/CookieBanner";

interface LocalUser {
  id: string;
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
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [randomThread, setRandomThread] = useState<RandomThread | null>(null);
  const [popularThreads, setPopularThreads] = useState<PopularThread[]>([]);
  const [showTerms, setShowTerms] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  
  useSessionTime(user?.id);
  useOnlineStatus(user?.id);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await api.auth.getSession();
      setUser((session?.user ?? null) as LocalUser | null);
      
      if (session?.user) {
        const { data: roles } = await api
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id);
        
        setIsModerator(roles?.some((r: { role: string }) => r.role === 'moderator' || r.role === 'admin') || false);

        // Load current user profile and color
        const { data: profile } = await api
          .from("profiles")
          .select("username")
          .eq("id", session.user.id)
          .single();

        if (profile) {
          setCurrentUserUsername((profile as Record<string, unknown>).username as string);
        }

        // Load current user color
        const { data: achievements } = await api
          .from("user_achievements")
          .select(`
            achievement_id,
            achievements (
              reward_type,
              reward_value
            )
          `)
          .eq("user_id", session.user.id);

        if (achievements) {
          const colorRewards = achievements
            .filter((a: Record<string, unknown>) => (a.achievements as Record<string, unknown>)?.reward_type === "username_color")
            .map((a: Record<string, unknown>) => (a.achievements as Record<string, unknown>).reward_value);

          const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
          for (const p of priority) {
            if (colorRewards.includes(p)) {
              setCurrentUserColor(p);
              break;
            }
          }
        }
        
        // Check if user has accepted terms
        const { data: termsData } = await api
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

    const { data: { subscription } } = api.auth.onAuthStateChange(
      (_event: string, session: { user?: { id: string } } | null) => {
        setUser((session?.user ?? null) as LocalUser | null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const loadRandomThread = async () => {
      const { data } = await api
        .from("threads")
        .select(`
          id,
          title,
          board_id,
          boards!inner(slug, is_gomosub)
        `)
        .eq("boards.is_gomosub", false)
        .limit(100);

      if (data && data.length > 0) {
        const randomIndex = Math.floor(Math.random() * data.length);
        setRandomThread(data[randomIndex] as unknown as RandomThread);
      }
    };

    const loadPopularThreads = async () => {
      const { data } = await api
        .from("threads")
        .select(`
          id,
          title,
          post_count,
          board_id,
          boards!inner(slug, name, is_gomosub)
        `)
        .eq("boards.is_gomosub", false)
        .order("post_count", { ascending: false })
        .limit(5);

      if (data) {
        setPopularThreads(data as unknown as PopularThread[]);
      }
    };

    const loadAll = async () => {
      setLoading(true);
      await Promise.all([
        loadRandomThread(),
        loadPopularThreads(),
      ]);
      setLoading(false);
    };
    loadAll();
  }, []);

  const handleLogout = async () => {
    await api.auth.signOut();
    toast.success("Вышли");
  };

  const handleAcceptTerms = async () => {
    if (!user) return;
    
    await api
      .from("user_terms_acceptance")
      .insert({
        user_id: user.id,
      });
    
    setShowTerms(false);
    setTermsAccepted(true);
    toast.success("Спасибо за согласие с правилами");
  };

  const handleDeclineTerms = async () => {
    await api.auth.signOut();
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
      <div className="flex-1 min-h-0">
        <header className="bg-board-header text-board-header-foreground p-3 sm:p-4 border-b border-border">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
          <img
            src="/photoes/gomo6.png"
            alt="gomo6"
            className="h-4 sm:h-5 md:h-6 w-auto object-contain flex-shrink-0 max-w-[80px] sm:max-w-[100px] md:max-w-[120px]"
          />
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            <Link to="/settings" className="hidden sm:block">
              <Button variant="ghost" size="sm" className="relative p-2 hover:bg-white/20 hover:text-white transition-colors group">
                <Settings className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
              </Button>
            </Link>
            {user && <NotificationBell userId={user.id} />}
            {user && <ChatIcon userId={user.id} />}
            {user ? (
              <>
                <div className="hidden sm:flex gap-1 sm:gap-2 items-center ml-2">
                  <HeaderUsername userId={user.id} />
                </div>
                <MobileMenu
                  user={user}
                  isModerator={isModerator}
                />
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => navigate("/auth")} className="text-xs sm:text-sm hover:bg-primary hover:text-primary-foreground transition-colors">
                Войти
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-3 sm:p-6">
        <div className="text-center mb-6 sm:mb-8">
        </div>

        <div className="mb-4 text-center flex gap-3 justify-center flex-wrap">
          <Link to="/rules">
            <Button variant="outline" className="relative hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors group">
              Информация
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Button>
          </Link>

          <Link to="/bugs">
            <Button variant="outline" className="relative hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors group">
              Баги/Идеи
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Button>
          </Link>

          <Link to="/faq">
            <Button variant="outline" className="relative hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors group">
              FAQ
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Button>
          </Link>
        </div>

        <div className="bg-card border border-border p-6 mb-6">
          <h3 className="text-xl font-bold mb-4">Популярные треды</h3>
          <div className="space-y-2">
            {popularThreads.map((thread) => (
              <Link
                key={thread.id}
                to={`/${thread.boards.slug}/thread/${thread.id}`}
                className="block p-3 border border-border hover:bg-thread-hover transition-all duration-200 group"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1 relative">
                    <div className="font-bold relative inline-block transition-transform duration-200 group-hover:translate-x-0.5">
                      {thread.title}
                      <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                    </div>
                    <div className="text-sm text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5">
                      /{thread.boards.slug}/ - {thread.boards.name}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground ml-2 transition-transform duration-200 group-hover:translate-x-0.5">
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
            {randomThread && (
              <div>
                <h4 className="font-semibold mb-2">Случайный тред:</h4>
                <Link
                  to={`/${randomThread.boards.slug}/thread/${randomThread.id}`}
                  className="block p-3 border border-border hover:bg-thread-hover transition-all duration-200 group"
                >
                  <div className="font-bold relative inline-block transition-transform duration-200 group-hover:translate-x-0.5">
                    {randomThread.title}
                    <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                  </div>
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
