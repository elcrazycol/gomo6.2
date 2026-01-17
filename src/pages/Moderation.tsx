import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Shield, Smile } from "lucide-react";

const Moderation = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
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
  };

  if (!isModerator) return null;

  return (
    <div className="bg-background min-h-screen">
      <main className="max-w-4xl mx-auto p-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Модерация</h1>
          <p className="text-muted-foreground">Центр управления контентом</p>
                          </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          {/* Модерация постов */}
          <Link to="/moderation/posts" className="group">
            <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl p-8 hover:bg-card/90 transition-all duration-300 hover:scale-105 hover:shadow-xl group-hover:border-primary/30">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="p-4 bg-primary/10 rounded-full group-hover:bg-primary/20 transition-colors">
                  <Shield className="h-8 w-8 text-primary" />
                      </div>
                <h3 className="text-xl font-semibold">Модерация</h3>
                <p className="text-sm text-muted-foreground">
                  Управление жалобами, банами и контентом пользователей
                </p>
                      </div>
                    </div>
          </Link>

          {/* Эмодзи */}
          <Link to="/moderation/emojis" className="group">
            <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl p-8 hover:bg-card/90 transition-all duration-300 hover:scale-105 hover:shadow-xl group-hover:border-primary/30">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="p-4 bg-primary/10 rounded-full group-hover:bg-primary/20 transition-colors">
                  <Smile className="h-8 w-8 text-primary" />
                                    </div>
                <h3 className="text-xl font-semibold">Эмодзи</h3>
                <p className="text-sm text-muted-foreground">
                  Создание и управление эмодзи для пользователей
                </p>
                        </div>
                      </div>
          </Link>
                </div>
      </main>
    </div>
  );
};

export default Moderation;