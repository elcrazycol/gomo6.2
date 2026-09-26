import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PrefetchLink } from "@/components/PrefetchLink";
import { api } from "@/integrations/api/compat";
import { useProfileCache } from "@/contexts/ProfileCacheContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Users } from "lucide-react";
import { UserBadge } from "@/components/UserBadge";
import { HeaderUsername } from "@/components/HeaderUsername";
import { TermsOfService } from "@/components/TermsOfService";
import { ThreadFeed } from "@/components/ThreadFeed";
import { useSessionTime } from "@/hooks/useSessionTime";
import { PentagramLoader } from "@/components/PentagramLoader";

interface Board {
  id: string;
  slug: string;
  name: string;
  description: string;
}

interface GomoSub {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

const Index = () => {
  const { loadProfile } = useProfileCache();
  const [boards, setBoards] = useState<Board[]>([]);
  const [gomoSubs, setGomoSubs] = useState<GomoSub[]>([]);
  const [gomoSubsMembers, setGomoSubsMembers] = useState<Record<string, number>>({});
  const [joinedGomoSubs, setJoinedGomoSubs] = useState<GomoSub[]>([]);
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [showTerms, setShowTerms] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  
  useSessionTime(user?.id);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await api.auth.getSession();
        setUser(session?.user ?? null);

        if (session?.user) {
          const [profileData, termsRes] = await Promise.all([
            loadProfile(session.user.id),
            api.from("user_terms_acceptance").select("*").eq("user_id", session.user.id).maybeSingle(),
          ]);		  setIsModerator(profileData.isAdmin);
          setCurrentUserUsername(profileData.username);

          if (!termsRes.data) {
            setShowTerms(true);
          } else {
            setTermsAccepted(true);
          }
        }
      } catch (error) {
        // A stale/expired session makes the protected user_terms_acceptance
        // call 401 — never let that surface as an unhandled rejection (guest
        // browsing). The feed still renders; only the mod flag/terms dialog
        // are skipped for this visit.
        console.error('Error loading auth data:', error);
      }
    };
    checkAuth();

    const { data: { subscription } } = api.auth.onAuthStateChange(
      (_event: unknown, session: { user: { id: string } | null } | null) => {
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  useEffect(() => {
    const loadSidebarData = async () => {
      const { data: boardsData } = await api
        .from("boards")
        .select("*")
        .eq("is_rules_board", false)
        .eq("is_gomosub", false)
        .order("created_at", { ascending: true });

      if (boardsData) {
        // Filter out /faq/ and /bugs/ boards from the main list
        const filteredBoards = boardsData.filter((board: { slug: string }) => board.slug !== 'faq' && board.slug !== 'bugs');
        setBoards(filteredBoards as unknown as Board[]);
      }

      const { data: gomoSubsData } = await api
        .from("boards")
        .select("id, slug, name, description")
        .eq("is_gomosub", true)
        .eq("visibility", "public")
        .order("created_at", { ascending: false })
        .limit(30);

      if (gomoSubsData) {
        const randomized = [...gomoSubsData]
          .sort(() => Math.random() - 0.5)
          .slice(0, 3);
        setGomoSubs(randomized);

        // gomosub_memberships is a protected table — anonymous callers get a
        // 401 that the API client surfaces as an unhandled rejection (guest
        // browsing). Fetch member counts only for signed-in viewers; guests
        // see the random subs without the count instead.
        const { data: { session } } = await api.auth.getSession();
        if (session?.user) {
          const counts = await Promise.all(
            randomized.map(async (sub) => {
              const { count } = await api
                .from("gomosub_memberships")
                .select("*", { count: "exact", head: true })
                .eq("board_id", sub.id);
              return { id: sub.id, count: count ?? 0 };
            })
          );
          const nextMap: Record<string, number> = {};
          counts.forEach((item) => {
            nextMap[item.id] = item.count;
          });
          setGomoSubsMembers(nextMap);
        }
      }
    };

    loadSidebarData();
      setLoading(false);
  }, []);

  useEffect(() => {
    // The sidebar lists the g-subs this user joined. The subscriptions FEED that
    // used to load here (thread_subscriptions → threads + posts, behind the
    // «Рекомендации / Подписки» toggle) has been removed.
    const loadJoinedGomoSubs = async () => {
      if (!user?.id) {
        setJoinedGomoSubs([]);
        return;
      }

      const fromResult = api.from("gomosub_memberships");
      if (!fromResult) return;
      const { data: memberships } = await fromResult
        .select("board_id")
        .eq("user_id", user.id);
      const joinedBoardIds = (memberships ?? []).map((m: { board_id: string }) => m.board_id);

      const { data: joinedBoardsData } = joinedBoardIds.length
        ? await api
            .from("boards")
            .select("id, slug, name, description")
            .in("id", joinedBoardIds)
            .order("created_at", { ascending: false })
        : { data: [] as GomoSub[] };
      setJoinedGomoSubs((joinedBoardsData as GomoSub[]) ?? []);
    };

    loadJoinedGomoSubs();
  }, [user?.id]);

  const handleLogout = async () => {
    await api.auth.signOut();
    toast.success("Вышли");
  };

  const handleAcceptTerms = async () => {
    if (!user) return;

    // The backend accepts the write idempotently (ON CONFLICT upsert). Only
    // close the dialog on success — otherwise the user would be told they
    // accepted while the row was never stored and the dialog re-appears.
    const { error } = await api
      .from("user_terms_acceptance")
      .insert({
        user_id: user.id,
      });

    if (error) {
      toast.error("Не удалось сохранить согласие. Попробуй ещё раз.");
      return;
    }

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
    <div className="bg-background min-h-screen">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-col lg:grid lg:grid-cols-4 gap-6">
          {/* Main Feed — recommendations only: the «Рекомендации / Подписки»
              toggle and the subscriptions view behind it were removed. */}
          <div className="lg:col-span-3">
            <ThreadFeed
              currentUserId={user?.id}
              currentUsername={currentUserUsername}
              currentUserColor={currentUserColor}
            />
          </div>

          {/* Sidebar - Desktop */}
          <div className="hidden lg:block lg:col-span-1">
            <div className="space-y-6">
              {/* Navigation */}
              <div className="bg-card border border-border rounded-lg p-4">
                <Button
                  onClick={() => navigate("/g")}
                  variant="outline"
                  className="w-full relative group hover:translate-x-0.5 transition-transform duration-200 hover:bg-primary/10 hover:text-primary hover:border-primary/50"
                >
                  <Users className="h-4 w-4 mr-2" />
                  G-сабы
                  <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                </Button>
        </div>

              {/* Boards List */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-4">Подписки</h3>
                <div className="space-y-2">
                  {joinedGomoSubs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Пока нет подписок</p>
                  ) : (
                    joinedGomoSubs.map((sub) => (
                      <PrefetchLink
                        key={sub.id}
                        to={`/g/${sub.slug}`}
                        className="block p-3 border border-border rounded hover:bg-thread-hover transition-colors group hover:translate-x-0.5 transition-transform duration-200"
                      >
                        <div className="font-medium text-primary relative">
                          g/{sub.slug}
                          <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                        </div>
                        <div className="text-sm text-muted-foreground line-clamp-2">{sub.name}</div>
                      </PrefetchLink>
                    ))
                  )}
                </div>
              </div>

              {/* Gomo Subs */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-4">Капля рандома</h3>
                <div className="space-y-2">
                  {gomoSubs.map((sub) => (
                    <PrefetchLink
                      key={sub.id}
                      to={`/g/${sub.slug}`}
                      className="block p-3 border border-border rounded hover:bg-thread-hover transition-colors group hover:translate-x-0.5 transition-transform duration-200"
                    >
                      <div className="font-medium text-primary relative">
                        g/{sub.slug}
                        <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                      </div>
                      {user && (
                        <div className="text-xs text-muted-foreground mb-1">
                          участников: {gomoSubsMembers[sub.id] ?? 0}
                        </div>
                      )}
                      <div className="text-sm text-muted-foreground line-clamp-2">
                        {sub.name}
                      </div>
                    </PrefetchLink>
                  ))}
                </div>
              </div>

              {/* Important Links */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-4">Важное</h3>
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
    </div>
  );
};

export default Index;
