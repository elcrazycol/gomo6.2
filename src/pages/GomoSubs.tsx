import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrefetchLink } from "@/components/PrefetchLink";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThreadCard } from "@/components/ThreadCard";
import { Loader2, Plus, Sparkles, UserPlus, UserCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { renderPreviewContent } from "@/utils/emojiUtils";
import { toast } from "sonner";

type GomoSub = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  cover_image_url?: string | null;
  rules_markdown?: string | null;
  rules_updated_at?: string | null;
  created_at: string;
  owner_id: string | null;
  owner?: {
    username?: string | null;
    avatar_url?: string | null;
  } | null;
};

const GomoSubs = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<{ garma: number; username?: string | null } | null>(null);
  const [subs, setSubs] = useState<GomoSub[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [joinedSubIds, setJoinedSubIds] = useState<Set<string>>(new Set());
  const [membersBySub, setMembersBySub] = useState<Record<string, number>>({});
  const [togglingSubId, setTogglingSubId] = useState<string | null>(null);
  const [myFeedThreads, setMyFeedThreads] = useState<any[]>([]);
  const [myFeedLoading, setMyFeedLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "my-feed">("all");

  const canCreate = useMemo(() => (profile?.garma ?? 0) > 100, [profile?.garma]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      setUserId(session?.user?.id ?? null);

      if (session?.user) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("garma, username")
          .eq("id", session.user.id)
          .single();
        if (profileData) {
          setProfile({ garma: profileData.garma ?? 0, username: profileData.username });
        }
      }

      const { data } = await supabase
        .from("boards")
        .select(`
          id,
          slug,
          name,
          description,
          cover_image_url,
          rules_markdown,
          rules_updated_at,
          created_at,
          owner_id,
          owner:profiles!boards_owner_id_fkey (
            username,
            avatar_url
          )
        `)
        .eq("is_gomosub", true)
        .order("created_at", { ascending: false });

      const loadedSubs = (data as GomoSub[]) ?? [];
      setSubs(loadedSubs);

      if (loadedSubs.length > 0) {
        const countResults = await Promise.all(
          loadedSubs.map(async (sub) => {
            const { count } = await supabase
              .from("gomosub_memberships")
              .select("*", { count: "exact", head: true })
              .eq("board_id", sub.id);
            return { boardId: sub.id, count: count ?? 0 };
          })
        );

        const nextCounts: Record<string, number> = {};
        countResults.forEach((item) => {
          nextCounts[item.boardId] = item.count;
        });
        setMembersBySub(nextCounts);
      }

      if (session?.user && loadedSubs.length > 0) {
        const { data: memberships } = await supabase
          .from("gomosub_memberships")
          .select("board_id")
          .eq("user_id", session.user.id)
          .in("board_id", loadedSubs.map((sub) => sub.id));

        setJoinedSubIds(new Set((memberships ?? []).map((m) => m.board_id)));
      } else {
        setJoinedSubIds(new Set());
      }

      setLoading(false);
    };

    load();
  }, []);

  useEffect(() => {
    const loadMyFeed = async () => {
      if (!userId) {
        setMyFeedThreads([]);
        return;
      }

      const joinedBoardIds = Array.from(joinedSubIds);
      if (joinedBoardIds.length === 0) {
        setMyFeedThreads([]);
        return;
      }

      setMyFeedLoading(true);
      const { data: threadsData, error } = await supabase
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
          tags,
          post_count,
          boards!inner (
            slug,
            name,
            is_gomosub
          )
        `)
        .in("board_id", joinedBoardIds)
        .order("updated_at", { ascending: false })
        .limit(40);

      if (error || !threadsData) {
        setMyFeedLoading(false);
        setMyFeedThreads([]);
        return;
      }

      const userIds = threadsData.map((thread) => thread.user_id).filter(Boolean);
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, username, is_anonymous, avatar_url")
        .in("id", userIds);

      const merged = threadsData.map((thread) => ({
        ...thread,
        profiles: profilesData?.find((profile) => profile.id === thread.user_id) || null
      }));
      setMyFeedThreads(merged);
      setMyFeedLoading(false);
    };

    loadMyFeed();
  }, [userId, joinedSubIds]);

  const toggleMembership = async (sub: GomoSub) => {
    if (!userId) {
      toast.error("Войди в аккаунт, чтобы вступать в сабы");
      navigate("/auth");
      return;
    }

    if (togglingSubId) return;
    setTogglingSubId(sub.id);

    const joined = joinedSubIds.has(sub.id);
    if (joined) {
      const { error } = await supabase
        .from("gomosub_memberships")
        .delete()
        .eq("board_id", sub.id)
        .eq("user_id", userId);

      setTogglingSubId(null);
      if (error) {
        toast.error("Не удалось выйти из саба");
        return;
      }
      setJoinedSubIds((prev) => {
        const next = new Set(prev);
        next.delete(sub.id);
        return next;
      });
      setMembersBySub((prev) => ({ ...prev, [sub.id]: Math.max(0, (prev[sub.id] ?? 0) - 1) }));
      return;
    }

    const { error } = await supabase
      .from("gomosub_memberships")
      .insert({ board_id: sub.id, user_id: userId });

    setTogglingSubId(null);
    if (error) {
      toast.error("Не удалось вступить в саб");
      return;
    }
    setJoinedSubIds((prev) => {
      const next = new Set(prev);
      next.add(sub.id);
      return next;
    });
    setMembersBySub((prev) => ({ ...prev, [sub.id]: (prev[sub.id] ?? 0) + 1 }));
  };

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-6 space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Отдельный раздел пользовательских g-сабов</p>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-3">
            G-сабы
            <Badge variant={canCreate ? "default" : "outline"} className="text-sm">
              gарма: {profile?.garma ?? 0} (нужно &gt;100)
            </Badge>
          </h1>
        </div>
        <div className="grid grid-cols-1 sm:flex gap-2 w-full sm:w-auto">
          <Button onClick={() => navigate("/boards")} variant="outline" className="w-full sm:w-auto">
            Основные доски
          </Button>
          <Button
            onClick={() => navigate("/g/create")}
            disabled={!canCreate}
            className="w-full sm:w-auto"
          >
            <Plus className="w-4 h-4 mr-2" />
            Создать g-саб
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "all" | "my-feed")} className="space-y-4">
        <TabsList className="grid w-full sm:w-fit grid-cols-2">
          <TabsTrigger value="all">Все g-сабы</TabsTrigger>
          <TabsTrigger value="my-feed">Моя лента</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Список g-сабов
            </h2>
            <Badge variant="outline">Всего: {subs.length}</Badge>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : subs.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center space-y-2">
                <p className="text-lg font-semibold">Пока нет пользовательских g-сабов</p>
                <p className="text-sm text-muted-foreground">Создай первый на отдельной странице создания</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
              {subs.map((sub) => (
                <Card key={sub.id} className="overflow-hidden border-border/80">
                  {sub.cover_image_url && (
                    <div
                      className="h-36 w-full bg-cover bg-center"
                      style={{ backgroundImage: `url(${sub.cover_image_url})` }}
                      aria-label={`Обложка g/${sub.slug}`}
                    />
                  )}
                  <CardContent className="space-y-3 pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">g/{sub.slug}</Badge>
                          <Badge variant="secondary">gomo саб</Badge>
                          <Badge variant="outline">участников: {membersBySub[sub.id] ?? 0}</Badge>
                        </div>
                        <div className="text-lg font-semibold">{sub.name}</div>
                        <p className="text-sm text-muted-foreground line-clamp-2">{sub.description}</p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                        <div>создан {formatDistanceToNow(new Date(sub.created_at), { addSuffix: true, locale: ru })}</div>
                        {sub.rules_updated_at && (
                          <div>правила {formatDistanceToNow(new Date(sub.rules_updated_at), { addSuffix: true, locale: ru })}</div>
                        )}
                      </div>
                    </div>

                    {sub.owner && sub.owner.username && (
                      <div className="text-sm text-muted-foreground">
                        Создатель:{" "}
                        <ProfileHoverCard userId={sub.owner_id || ""}>
                          <span className="font-medium text-foreground">@{sub.owner.username}</span>
                        </ProfileHoverCard>
                      </div>
                    )}

                    {sub.rules_markdown && (
                      <div className="border border-border/70 rounded-md p-2 bg-muted/40">
                        <div className="text-xs font-medium text-muted-foreground mb-1">Правила</div>
                        <div className="prose prose-sm max-w-none line-clamp-4">
                          {renderPreviewContent(sub.rules_markdown, `rules-${sub.id}`)}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:flex gap-2">
                      <PrefetchLink to={`/g/${sub.slug}`}>
                        <Button size="sm" variant="outline" className="w-full">Перейти</Button>
                      </PrefetchLink>
                      <Button
                        size="sm"
                        variant={joinedSubIds.has(sub.id) ? "secondary" : "default"}
                        className="w-full"
                        onClick={() => toggleMembership(sub)}
                        disabled={togglingSubId === sub.id}
                      >
                        {joinedSubIds.has(sub.id) ? (
                          <>
                            <UserCheck className="w-4 h-4 mr-2" />
                            Вы участник
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-4 h-4 mr-2" />
                            Вступить
                          </>
                        )}
                      </Button>
                      <PrefetchLink to={`/g/${sub.slug}/create`}>
                        <Button size="sm" variant="secondary" className="w-full">Создать тред</Button>
                      </PrefetchLink>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="my-feed" className="space-y-4">
          {!userId ? (
            <Card>
              <CardContent className="py-8 text-center space-y-2">
                <p className="font-semibold">Войди, чтобы видеть персональную ленту</p>
                <Button onClick={() => navigate("/auth")} className="mt-2">Войти</Button>
              </CardContent>
            </Card>
          ) : myFeedLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : myFeedThreads.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center space-y-2">
                <p className="font-semibold">Лента пока пустая</p>
                <p className="text-sm text-muted-foreground">Вступи в g-сабы, и тут появятся их свежие треды</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {myFeedThreads.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  currentUserId={userId}
                  currentUsername={profile?.username || ""}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default GomoSubs;
