import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/api/supabaseCompat";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Settings, Plus, Edit3, ArrowLeft } from "lucide-react";

const EmojiModeration = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");

  const checkAuth = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      navigate("/auth");
      return;
    }

    setUser(user);

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const isMod = roles?.some(r => r.role === 'moderator' || r.role === 'admin');

    if (!isMod) {
      toast.error("У вас нет доступа к этой странице");
      navigate("/");
      return;
    }

    setIsModerator(true);

    // Load current user profile and color
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single();

    if (profile) {
      setCurrentUserUsername(profile.username);
    }

    // Load current user color
    const { data: achievements } = await supabase
      .from("user_achievements")
      .select(`
        achievement_id,
        achievements (
          reward_type,
          reward_value
        )
      `)
      .eq("user_id", user.id);

    if (achievements) {
      const colorRewards = achievements
        .filter((a: any) => a.achievements?.reward_type === "username_color")
        .map((a: any) => a.achievements.reward_value);

      const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
      for (const p of priority) {
        if (colorRewards.includes(p)) {
          setCurrentUserColor(p);
          break;
        }
      }
    }
  }, [navigate]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (!isModerator) return null;

  return (
    <div className="bg-background min-h-screen">
      <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <Link to="/moderation">
              <Button variant="ghost" size="sm" className="p-2 hover:bg-white/20 hover:text-white transition-colors">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Модерация эмодзи</h1>
          </div>
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            <Link to="/settings" className="hidden sm:block">
              <Button variant="ghost" size="sm" className="p-2 hover:bg-white/20 hover:text-white transition-colors">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            {user && <NotificationBell userId={user.id} />}
            {user && <ChatIcon userId={user.id} />}
            <div className="hidden sm:flex gap-1 sm:gap-2 items-center ml-2">
              {user && (
                <ProfileHoverCard userId={user.id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`text-sm sm:text-base hover:bg-white/20 hover:text-white transition-colors drop-shadow-[0_0_1px_rgba(255,255,255,0.8)] ${
                      currentUserColor === 'purple' ? 'text-purple-500' :
                      currentUserColor === 'gold' ? 'text-yellow-500' :
                      currentUserColor === 'orange' ? 'text-orange-500' :
                      currentUserColor === 'red' ? 'text-red-500' :
                      currentUserColor === 'blue' ? 'text-blue-500' :
                      currentUserColor === 'green' ? 'text-green-500' :
                      currentUserColor === 'yellow' ? 'text-yellow-400' :
                      currentUserColor === 'cyan' ? 'text-cyan-500' :
                      'text-quote'
                    }`}
                    onClick={() => navigate(`/profile/${user.id}`)}
                  >
                    {currentUserUsername || 'Профиль'}
                  </Button>
                </ProfileHoverCard>
              )}
            </div>
            {user && (
              <MobileMenu
                user={user}
                isModerator={true}
              />
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2">Управление эмодзи</h1>
          <p className="text-muted-foreground">Создание и редактирование эмодзи</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          {/* Создать эмодзи */}
          <Link to="/moderation/emojis/create" className="group">
            <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl p-8 hover:bg-card/90 transition-all duration-300 hover:scale-105 hover:shadow-xl group-hover:border-primary/30">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="p-4 bg-primary/10 rounded-full group-hover:bg-primary/20 transition-colors">
                  <Plus className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Создать</h3>
                <p className="text-sm text-muted-foreground">
                  Добавить новый эмодзи в систему
                </p>
              </div>
            </div>
          </Link>

          {/* Редактировать эмодзи */}
          <Link to="/moderation/emojis/edit" className="group">
            <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl p-8 hover:bg-card/90 transition-all duration-300 hover:scale-105 hover:shadow-xl group-hover:border-primary/30">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="p-4 bg-blue-500/10 rounded-full group-hover:bg-blue-500/20 transition-colors">
                  <Edit3 className="h-8 w-8 text-blue-500" />
                </div>
                <h3 className="text-xl font-semibold">Редактировать</h3>
                <p className="text-sm text-muted-foreground">
                  Изменить существующие эмодзи
                </p>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
};

export default EmojiModeration;