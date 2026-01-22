import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PrefetchLink } from "@/components/PrefetchLink";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Settings, Plus, Grid3X3 } from "lucide-react";
import { UserBadge } from "@/components/UserBadge";
import { HeaderUsername } from "@/components/HeaderUsername";
import { TermsOfService } from "@/components/TermsOfService";
import { ThreadFeed } from "@/components/ThreadFeed";
import { CreateThreadWizard } from "@/components/CreateThreadWizard";
import { useSessionTime } from "@/hooks/useSessionTime";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { PentagramLoader } from "@/components/PentagramLoader";

interface Board {
  id: string;
  slug: string;
  name: string;
  description: string;
}

const Index = () => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [showTerms, setShowTerms] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const navigate = useNavigate();
  
  useSessionTime(user?.id);
  useOnlineStatus(user?.id);

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

        // Check if we need to open create wizard (from mobile menu)
        const shouldOpenWizard = localStorage.getItem('open_create_wizard');
        if (shouldOpenWizard === 'true') {
          localStorage.removeItem('open_create_wizard');
          setShowCreateWizard(true);
        }

        // Load current user profile and color
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", session.user.id)
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
          .eq("user_id", session.user.id);

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
        // Filter out /faq/ and /bugs/ boards from the main list
        const filteredBoards = data.filter(board => board.slug !== 'faq' && board.slug !== 'bugs');
        setBoards(filteredBoards);
      }
    };

    loadBoards();
      setLoading(false);
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
    <div className="bg-background min-h-screen">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col lg:grid lg:grid-cols-4 gap-6">
          {/* Main Feed */}
          <div className="lg:col-span-3">
            <div className="mb-6">
              <h1 className="text-2xl font-bold">Поток тредов</h1>
        </div>

            <ThreadFeed
              currentUserId={user?.id}
              currentUsername={currentUserUsername}
              currentUserColor={currentUserColor}
            />
          </div>

          {/* Sidebar - Desktop */}
          <div className="hidden lg:block lg:col-span-1">
            <div className="space-y-6">
              {/* Create Thread Button */}
              <div className="bg-card border border-border rounded-lg p-4">
                <Button
                  onClick={() => setShowCreateWizard(true)}
                  className="w-full mb-3 relative group hover:translate-x-0.5 transition-transform duration-200"
                  size="lg"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Создать тред
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Button>

                <Button
                  onClick={() => navigate("/boards")}
                  variant="outline"
                  className="w-full relative group hover:translate-x-0.5 transition-transform duration-200 hover:bg-primary/10 hover:text-primary hover:border-primary/50"
                >
                  <Grid3X3 className="h-4 w-4 mr-2" />
                  Просмотр по доскам
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Button>
        </div>

              {/* Boards List */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-4">Доски</h3>
                <div className="space-y-2">
            {boards.map((board) => (
                <PrefetchLink
                      key={board.id}
                  to={`/${board.slug}`}
                      className="block p-3 border border-border rounded hover:bg-thread-hover transition-colors group hover:translate-x-0.5 transition-transform duration-200"
                >
                      <div className="font-medium text-primary relative">
                        /{board.slug}/
                        <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                    </div>
                      <div className="text-sm text-muted-foreground">
                        {board.name}
                </div>
              </PrefetchLink>
            ))}
          </div>
        </div>

              {/* Quick Links */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-4">Быстрые ссылки</h3>
              <div className="space-y-2">
                  <PrefetchLink to="/rules">
                    <Button variant="outline" className="w-full justify-start relative group hover:translate-x-0.5 transition-transform duration-200 hover:bg-primary/10 hover:text-primary hover:border-primary/50">
                      Информация
                      <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                    </Button>
                  </PrefetchLink>

                  <PrefetchLink to="/bugs">
                    <Button variant="outline" className="w-full justify-start relative group hover:translate-x-0.5 transition-transform duration-200 hover:bg-primary/10 hover:text-primary hover:border-primary/50">
                      Баги/Идеи
                      <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                    </Button>
                  </PrefetchLink>

                  <PrefetchLink to="/faq">
                    <Button variant="outline" className="w-full justify-start relative group hover:translate-x-0.5 transition-transform duration-200 hover:bg-primary/10 hover:text-primary hover:border-primary/50">
                      FAQ
                      <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                    </Button>
                  </PrefetchLink>
                </div>
              </div>
            </div>
          </div>

          </div>
        </div>

        <TermsOfService
          open={showTerms}
          onAccept={handleAcceptTerms}
          onDecline={handleDeclineTerms}
          canDecline={true}
        />

      {showCreateWizard && (
        <CreateThreadWizard
          boards={boards}
          onClose={() => setShowCreateWizard(false)}
        />
      )}

    </div>
  );
};

export default Index;
