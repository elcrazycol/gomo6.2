import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PrefetchLink } from "@/components/PrefetchLink";
import { supabase } from "@/integrations/api/client_simple";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Grid3X3, Users } from "lucide-react";
import { UserBadge } from "@/components/UserBadge";
import { HeaderUsername } from "@/components/HeaderUsername";
import { TermsOfService } from "@/components/TermsOfService";
import { ThreadFeed } from "@/components/ThreadFeed";
import { ThreadCard } from "@/components/ThreadCard";
import { useSessionTime } from "@/hooks/useSessionTime";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { PentagramLoader } from "@/components/PentagramLoader";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

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

interface FeedThread {
  id: string;
  title: string;
  content: string;
  image_url: string | null;
  image_urls?: string[] | null;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  board_id: string;
  post_count: number;
  tags?: any;
  profiles: {
    username: string;
    is_anonymous: boolean;
    avatar_url?: string | null;
  } | null;
  boards: {
    slug: string;
    name: string;
    is_gomosub?: boolean | null;
  };
}

interface SubscribedPostUpdate {
  id: string;
  content: string;
  created_at: string;
  thread_id: string;
  user_id: string | null;
  thread_title: string;
  board_slug: string;
  board_is_gomosub: boolean;
  author_username: string;
}

const Index = () => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [gomoSubs, setGomoSubs] = useState<GomoSub[]>([]);
  const [gomoSubsMembers, setGomoSubsMembers] = useState<Record<string, number>>({});
  const [joinedGomoSubs, setJoinedGomoSubs] = useState<GomoSub[]>([]);
  const [subscriptionsFeed, setSubscriptionsFeed] = useState<FeedThread[]>([]);
  const [subscribedPostUpdates, setSubscribedPostUpdates] = useState<SubscribedPostUpdate[]>([]);
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false);
  const [activeFeed, setActiveFeed] = useState<"recommended" | "subscriptions">("recommended");
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [showTerms, setShowTerms] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
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
    const loadSidebarData = async () => {
      const { data: boardsData } = await supabase
        .from("boards")
        .select("*")
        .eq("is_rules_board", false)
        .eq("is_gomosub", false)
        .order("created_at", { ascending: true });

      if (boardsData) {
        // Filter out /faq/ and /bugs/ boards from the main list
        const filteredBoards = boardsData.filter(board => board.slug !== 'faq' && board.slug !== 'bugs');
        setBoards(filteredBoards);
      }

      const { data: gomoSubsData } = await supabase
        .from("boards")
        .select("id, slug, name, description")
        .eq("is_gomosub", true)
        .order("created_at", { ascending: false })
        .limit(30);

      if (gomoSubsData) {
        const randomized = [...gomoSubsData]
          .sort(() => Math.random() - 0.5)
          .slice(0, 3);
        setGomoSubs(randomized);
        const counts = await Promise.all(
          randomized.map(async (sub) => {
            const { count } = await supabase
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
    };

    loadSidebarData();
      setLoading(false);
  }, []);

  useEffect(() => {
    const loadSubscriptions = async () => {
      if (!user?.id) {
        setJoinedGomoSubs([]);
        setSubscriptionsFeed([]);
        setSubscribedPostUpdates([]);
        return;
      }

      setSubscriptionsLoading(true);

      const { data: memberships } = await supabase
        .from("gomosub_memberships")
        .select("board_id")
        .eq("user_id", user.id);
      const joinedBoardIds = (memberships ?? []).map((m) => m.board_id);

      const { data: joinedBoardsData } = joinedBoardIds.length
        ? await supabase
            .from("boards")
            .select("id, slug, name, description")
            .in("id", joinedBoardIds)
            .order("created_at", { ascending: false })
        : { data: [] as any[] };
      setJoinedGomoSubs((joinedBoardsData as GomoSub[]) ?? []);

      const { data: threadSubs } = await supabase
        .from("thread_subscriptions")
        .select("thread_id")
        .eq("user_id", user.id);
      const subscribedThreadIds = (threadSubs ?? []).map((t) => t.thread_id);

      let threadsQuery = supabase
        .from("threads")
        .select(`
          id,
          title,
          content,
          image_url,
          image_urls,
          created_at,
          updated_at,
          user_id,
          board_id,
          post_count,
          tags,
          boards!inner(slug, name, is_gomosub)
        `)
        .order("updated_at", { ascending: false })
        .limit(80);

      if (joinedBoardIds.length > 0 && subscribedThreadIds.length > 0) {
        threadsQuery = threadsQuery.or(`board_id.in.(${joinedBoardIds.join(",")}),id.in.(${subscribedThreadIds.join(",")})`);
      } else if (joinedBoardIds.length > 0) {
        threadsQuery = threadsQuery.in("board_id", joinedBoardIds);
      } else if (subscribedThreadIds.length > 0) {
        threadsQuery = threadsQuery.in("id", subscribedThreadIds);
      } else {
        setSubscriptionsFeed([]);
        setSubscribedPostUpdates([]);
        setSubscriptionsLoading(false);
        return;
      }

      const { data: rawThreadsData } = await threadsQuery;
      const threadsData = (rawThreadsData ?? []) as any[];
      const dedupThreads = Array.from(new Map(threadsData.map((t: any) => [t.id, t])).values());
      const threadAuthorIds = dedupThreads.map((t) => t.user_id).filter(Boolean);
      const { data: threadAuthors } = threadAuthorIds.length
        ? await supabase
            .from("profiles")
            .select("id, username, is_anonymous, avatar_url")
            .in("id", threadAuthorIds)
        : { data: [] as any[] };

      const feedThreads: FeedThread[] = dedupThreads.map((thread: any) => ({
        ...thread,
        profiles: (threadAuthors ?? []).find((p: any) => p.id === thread.user_id) || null,
      }));
      setSubscriptionsFeed(feedThreads);

      if (subscribedThreadIds.length > 0) {
        const { data: postsData } = await supabase
          .from("posts")
          .select("id, content, created_at, thread_id, user_id")
          .in("thread_id", subscribedThreadIds)
          .neq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(12);

        if (postsData && postsData.length > 0) {
          const threadIds = Array.from(new Set(postsData.map((p) => p.thread_id)));
          const authorIds = Array.from(new Set(postsData.map((p) => p.user_id).filter(Boolean)));

          const [{ data: postThreads }, { data: postAuthors }] = await Promise.all([
            supabase
              .from("threads")
              .select("id, title, board_id, boards!inner(slug, is_gomosub)")
              .in("id", threadIds),
            authorIds.length
              ? supabase
                  .from("profiles")
                  .select("id, username")
                  .in("id", authorIds)
              : Promise.resolve({ data: [] as any[] }),
          ]);

          const postUpdates: SubscribedPostUpdate[] = postsData.map((post: any) => {
            const thread = (postThreads ?? []).find((t: any) => t.id === post.thread_id);
            const author = (postAuthors ?? []).find((a: any) => a.id === post.user_id);
            return {
              id: post.id,
              content: post.content,
              created_at: post.created_at,
              thread_id: post.thread_id,
              user_id: post.user_id,
              thread_title: thread?.title || "Тред",
              board_slug: thread?.boards?.slug || "b",
              board_is_gomosub: Boolean(thread?.boards?.is_gomosub),
              author_username: author?.username || "Аноним",
            };
          });
          setSubscribedPostUpdates(postUpdates);
        } else {
          setSubscribedPostUpdates([]);
        }
      } else {
        setSubscribedPostUpdates([]);
      }

      setSubscriptionsLoading(false);
    };

    loadSubscriptions();
  }, [user?.id]);

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
              <div className="inline-flex items-center rounded-xl border border-border bg-card/80 p-1 shadow-sm backdrop-blur">
                <div className="relative grid grid-cols-2">
                  <span
                    className={`absolute top-0 bottom-0 w-1/2 rounded-lg bg-primary/15 border border-primary/25 transition-transform duration-200 ${
                      activeFeed === "subscriptions" ? "translate-x-full" : "translate-x-0"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setActiveFeed("recommended")}
                    className={`relative z-10 px-4 py-2 text-sm font-medium transition-colors ${
                      activeFeed === "recommended" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Рекомендации
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveFeed("subscriptions")}
                    className={`relative z-10 px-4 py-2 text-sm font-medium transition-colors ${
                      activeFeed === "subscriptions" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Подписки
                  </button>
                </div>
              </div>
        </div>

            {activeFeed === "recommended" ? (
              <ThreadFeed
                currentUserId={user?.id}
                currentUsername={currentUserUsername}
                currentUserColor={currentUserColor}
              />
            ) : !user ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">Войди в аккаунт, чтобы видеть поток подписок</p>
                </CardContent>
              </Card>
            ) : subscriptionsLoading ? (
              <div className="flex justify-center py-8">
                <PentagramLoader size="md" />
              </div>
            ) : (
              <div className="space-y-4">
                <Card className="border-primary/30">
                  <CardHeader>
                    <CardTitle className="text-lg">Новые посты в подписанных тредах</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {subscribedPostUpdates.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Пока нет новых постов</p>
                    ) : (
                      subscribedPostUpdates.map((item) => (
                        <PrefetchLink
                          key={item.id}
                          to={`${item.board_is_gomosub ? "/g" : ""}/${item.board_slug}/thread/${item.thread_id}`}
                          className="block rounded-lg border border-border p-3 hover:bg-thread-hover transition-colors"
                        >
                          <div className="text-xs text-muted-foreground mb-1">
                            @{item.author_username} - {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: ru })}
                          </div>
                          <div className="font-medium text-sm">{item.thread_title}</div>
                          <div className="text-sm text-muted-foreground line-clamp-2 mt-1">{item.content}</div>
                        </PrefetchLink>
                      ))
                    )}
                  </CardContent>
                </Card>

                {subscriptionsFeed.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center">
                      <p className="text-muted-foreground">Подпишись на g-сабы и треды, чтобы собрать свою ленту</p>
                    </CardContent>
                  </Card>
                ) : (
                  subscriptionsFeed.map((thread) => (
                    <ThreadCard
                      key={thread.id}
                      thread={thread}
                      currentUserId={user?.id ?? null}
                      currentUsername={currentUserUsername}
                      currentUserColor={currentUserColor}
                      hideTimestampOnCompactMobile={true}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          {/* Sidebar - Desktop */}
          <div className="hidden lg:block lg:col-span-1">
            <div className="space-y-6">
              {/* Navigation */}
              <div className="bg-card border border-border rounded-lg p-4">
                <Button
                  onClick={() => navigate("/boards")}
                  variant="outline"
                  className="w-full mb-3 relative group hover:translate-x-0.5 transition-transform duration-200 hover:bg-primary/10 hover:text-primary hover:border-primary/50"
                >
                  <Grid3X3 className="h-4 w-4 mr-2" />
                  Основные доски
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Button>

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
                      <div className="text-xs text-muted-foreground mb-1">
                        участников: {gomoSubsMembers[sub.id] ?? 0}
                      </div>
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
