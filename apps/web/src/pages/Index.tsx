import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PrefetchLink } from "@/components/PrefetchLink";
import { api } from "@/integrations/api/compat";
import { useProfileCache } from "@/contexts/ProfileCacheContext";
import { toast } from "sonner";
import { BookOpenText, Bug, ChevronRight, Hash, HelpCircle, Users } from "lucide-react";
import { TermsOfService } from "@/components/TermsOfService";
import { ThreadFeed } from "@/components/ThreadFeed";
import { useSessionTime } from "@/hooks/useSessionTime";
import { PentagramLoader } from "@/components/PentagramLoader";

interface GomoSub {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

const Index = () => {
  const { loadProfile } = useProfileCache();
  const [gomoSubs, setGomoSubs] = useState<GomoSub[]>([]);
  const [gomoSubsMembers, setGomoSubsMembers] = useState<Record<string, number>>({});
  const [joinedGomoSubs, setJoinedGomoSubs] = useState<GomoSub[]>([]);
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  // Consumed by ProcessedContent to colour @-mentions of the current user inside
  // post text, but nothing computes it any more (nickname colours now come from
  // profile_customization, not from the legacy colour presets), so mentions fall
  // back to the theme's quote colour. Flagged rather than removed: dropping the
  // prop means touching ProcessedContent + every card that threads it through.
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [showTerms, setShowTerms] = useState(false);
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
          ]);
          setCurrentUserUsername(profileData.username);

          if (!termsRes.data) {
            setShowTerms(true);
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

          {/* Sidebar - Desktop. Kept for now, but restyled into the feed cards'
              language: outlined rounded-2xl panels, a leading 32px chip, muted
              meta on the right, no underline/track animations. */}
          <div className="hidden lg:block lg:col-span-1">
            <div className="space-y-4">
              {/* G-сабы */}
              <div className="overflow-clip rounded-2xl border border-border/70 bg-background">
                <button
                  type="button"
                  onClick={() => navigate("/g")}
                  className="flex w-full items-center gap-2.5 px-3 py-3 text-sm font-medium transition-colors hover:bg-muted/60 sm:px-4"
                >
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                    <Users className="h-4 w-4 text-primary" />
                  </span>
                  G-сабы
                  <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </div>

              {/* Подписки */}
              <div className="overflow-clip rounded-2xl border border-border/70 bg-background">
                <h3 className="px-3 pt-3 text-[13px] font-semibold text-muted-foreground sm:px-4 sm:pt-4">
                  Подписки
                </h3>
                <div className="p-2 sm:p-2.5">
                  {joinedGomoSubs.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-[13px] text-muted-foreground">Пока нет подписок</p>
                  ) : (
                    joinedGomoSubs.map((sub) => (
                      <PrefetchLink
                        key={sub.id}
                        to={`/g/${sub.slug}`}
                        className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted/60"
                      >
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                          <Hash className="h-4 w-4 text-primary" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold leading-5 text-primary">g/{sub.slug}</span>
                          <span className="block text-[13px] leading-5 text-muted-foreground line-clamp-2">{sub.name}</span>
                        </span>
                      </PrefetchLink>
                    ))
                  )}
                </div>
              </div>

              {/* Капля рандома */}
              <div className="overflow-clip rounded-2xl border border-border/70 bg-background">
                <h3 className="px-3 pt-3 text-[13px] font-semibold text-muted-foreground sm:px-4 sm:pt-4">
                  Капля рандома
                </h3>
                <div className="p-2 sm:p-2.5">
                  {gomoSubs.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-[13px] text-muted-foreground">Пока нечего показать</p>
                  ) : (
                    gomoSubs.map((sub) => (
                      <PrefetchLink
                        key={sub.id}
                        to={`/g/${sub.slug}`}
                        className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted/60"
                      >
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                          <Hash className="h-4 w-4 text-primary" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold leading-5 text-primary">g/{sub.slug}</span>
                          <span className="block text-[13px] leading-5 text-muted-foreground line-clamp-2">{sub.name}</span>
                        </span>
                        {user && (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                            <Users className="h-3 w-3" aria-hidden="true" />
                            {gomoSubsMembers[sub.id] ?? 0}
                          </span>
                        )}
                      </PrefetchLink>
                    ))
                  )}
                </div>
              </div>

              {/* Важное */}
              <div className="overflow-clip rounded-2xl border border-border/70 bg-background">
                <h3 className="px-3 pt-3 text-[13px] font-semibold text-muted-foreground sm:px-4 sm:pt-4">
                  Важное
                </h3>
                <div className="p-2 sm:p-2.5">
                  <PrefetchLink
                    to="/rules"
                    className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-colors hover:bg-muted/60"
                  >
                    <BookOpenText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    Информация
                    <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                  </PrefetchLink>

                  <PrefetchLink
                    to="/bugs"
                    className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-colors hover:bg-muted/60"
                  >
                    <Bug className="h-4 w-4 shrink-0 text-muted-foreground" />
                    Баги/Идеи
                    <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                  </PrefetchLink>

                  <PrefetchLink
                    to="/faq"
                    className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-colors hover:bg-muted/60"
                  >
                    <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    FAQ
                    <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
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
