import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PrefetchLink } from "@/components/PrefetchLink";
import { api } from "@/integrations/api/compat";
import { useProfileCache } from "@/contexts/ProfileCacheContext";
import { toast } from "sonner";
import { Bookmark, ChevronRight, FileText, Hash, History, Home, Plus, Users } from "lucide-react";
import { TermsOfService } from "@/components/TermsOfService";
import { ThreadFeed } from "@/components/ThreadFeed";
import { useSessionTime } from "@/hooks/useSessionTime";
import { useThreadSections } from "@/hooks/useThreadSections";
import { SectionIcon } from "@/components/topic/sectionIcons";
import { SectionThreads } from "@/components/SectionThreads";
import { MyPosts } from "@/components/MyPosts";
import { HistoryView } from "@/components/HistoryView";
import { FavoritesView } from "@/components/FavoritesView";
import { Spotlight } from "@/components/Spotlight";
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
  // Sidebar «Разделы»: which section is expanded to show its subsections.
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const { sections } = useThreadSections();
  // Selected раздел / подраздел come from the URL so the view is shareable and
  // survives a reload.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSectionSlug = searchParams.get("section");
  const activeSubSlug = searchParams.get("sub");
  const activeSection = activeSectionSlug
    ? sections.find((s) => s.slug === activeSectionSlug) ?? null
    : null;
  const activeSubsection =
    activeSection && activeSubSlug
      ? activeSection.subsections.find((ss) => ss.slug === activeSubSlug) ?? null
      : null;
  // Which view is actually on screen. When a section or «Мои записи» is picked
  // we keep the previous view visible until the new one reports ready, so
  // switching never flashes a skeleton.
  const viewParam = searchParams.get("view");
  const targetMode: "feed" | "section" | "mine" | "history" | "favorites" = activeSection
    ? "section"
    : viewParam === "mine"
      ? "mine"
      : viewParam === "history"
        ? "history"
        : viewParam === "favorites"
          ? "favorites"
          : "feed";
  const [shownMode, setShownMode] = useState<"feed" | "section" | "mine" | "history" | "favorites">("feed");
  useEffect(() => {
    if (targetMode === "feed") setShownMode("feed");
  }, [targetMode]);
  const handleSectionReady = useCallback(() => setShownMode("section"), []);
  const handleMineReady = useCallback(() => setShownMode("mine"), []);
  const handleHistoryReady = useCallback(() => setShownMode("history"), []);
  const handleFavoritesReady = useCallback(() => setShownMode("favorites"), []);
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
            {/* The feed stays mounted (just hidden) while a section / «Мои
                записи» is shown, so returning to it is instant. The other views
                do their own loading and drive the header loading line; the
                previous view stays visible until they report ready. */}
            <div className={shownMode === "feed" ? undefined : "hidden"}>
              <ThreadFeed
                currentUserId={user?.id}
                currentUsername={currentUserUsername}
                currentUserColor={currentUserColor}
              />
            </div>
            {activeSection && (
              <div className={shownMode === "section" ? undefined : "hidden"}>
                <SectionThreads
                  section={activeSection}
                  subsection={activeSubsection}
                  currentUserId={user?.id ?? null}
                  currentUsername={currentUserUsername}
                  currentUserColor={currentUserColor}
                  onReady={handleSectionReady}
                />
              </div>
            )}
            {viewParam === "mine" && (
              <div className={shownMode === "mine" ? undefined : "hidden"}>
                <MyPosts
                  currentUserId={user?.id ?? null}
                  currentUsername={currentUserUsername}
                  currentUserColor={currentUserColor}
                  onReady={handleMineReady}
                />
              </div>
            )}
            {viewParam === "history" && (
              <div className={shownMode === "history" ? undefined : "hidden"}>
                <HistoryView
                  currentUserId={user?.id ?? null}
                  currentUsername={currentUserUsername}
                  currentUserColor={currentUserColor}
                  onReady={handleHistoryReady}
                />
              </div>
            )}
            {viewParam === "favorites" && (
              <div className={shownMode === "favorites" ? undefined : "hidden"}>
                <FavoritesView
                  currentUserId={user?.id ?? null}
                  currentUsername={currentUserUsername}
                  currentUserColor={currentUserColor}
                  onReady={handleFavoritesReady}
                />
              </div>
            )}
          </div>

          {/* Sidebar - Desktop. Outlined surface panels in the feed cards'
              language: --card-radius, a leading icon, muted meta on the right. */}
          <div className="hidden lg:block lg:col-span-1">
            <div className="space-y-4">
              {/* Create topic — a compact accent pill, deliberately separate
                  from the neutral sidebar panels. */}
              <Spotlight
                className="block w-fit"
                overlayClassName="rounded-full"
                color="hsl(var(--primary-foreground) / 0.35)"
              >
                <PrefetchLink
                  to="/create"
                  className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground shadow-md shadow-primary/30 transition-transform duration-150 hover:scale-[1.03] active:scale-95"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Создать тему
                </PrefetchLink>
              </Spotlight>

              {/* Primary nav. Feed clears any section filter; the other items
                  are still UI-only. */}
              <nav className="overflow-clip rounded-[var(--card-radius)] border border-border/70 bg-surface p-1.5">
                {([
                  { key: "feed", label: "Feed", icon: Home, active: targetMode === "feed" },
                  { key: "mine", label: "Мои записи", icon: FileText, active: targetMode === "mine" },
                  { key: "history", label: "История", icon: History, active: targetMode === "history" },
                  { key: "favorites", label: "Избранное", icon: Bookmark, active: targetMode === "favorites" },
                ] as const).map(({ key, label, icon: Icon, active }) => (
                  <Spotlight key={key} className="block">
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={
                        key === "feed"
                          ? () => setSearchParams({})
                          : key === "mine"
                            ? () => setSearchParams({ view: "mine" })
                            : key === "history"
                              ? () => setSearchParams({ view: "history" })
                              : key === "favorites"
                                ? () => setSearchParams({ view: "favorites" })
                                : undefined
                      }
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        active
                          ? "bg-primary/10 font-semibold text-primary"
                          : "text-foreground/80 hover:bg-muted/60 hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                      {label}
                    </button>
                  </Spotlight>
                ))}
              </nav>

              {/* Разделы тредов — click loads the section's threads below; the
                  chevron row also expands it to its подразделы. */}
              {sections.length > 0 && (
                <div className="overflow-clip rounded-[var(--card-radius)] border border-border/70 bg-surface">
                  <h3 className="px-3 pt-3 text-[13px] font-semibold text-muted-foreground sm:px-4 sm:pt-4">
                    Разделы
                  </h3>
                  <div className="p-1.5">
                    {sections.map((section) => {
                      const hasSubsections = section.subsections.length > 0;
                      const isActive = activeSection?.id === section.id;
                      // A section is open when toggled, or when one of its
                      // подразделы is the active view (so it stays visible).
                      const expanded = expandedSection === section.id || (isActive && Boolean(activeSubsection));
                      return (
                        <div key={section.id}>
                          <Spotlight
                            className={`flex items-center gap-0.5 rounded-lg transition-colors ${
                              isActive ? "bg-primary/10" : "hover:bg-muted/60"
                            }`}
                          >
                            <button
                              type="button"
                              aria-current={isActive ? "page" : undefined}
                              onClick={() => setSearchParams({ section: section.slug })}
                              className={`flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-sm transition-colors ${
                                isActive
                                  ? "font-semibold text-primary"
                                  : "text-foreground/80 hover:text-foreground"
                              }`}
                            >
                              <SectionIcon name={section.icon} className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                              <span className="min-w-0 flex-1 truncate text-left">{section.name}</span>
                            </button>
                            {hasSubsections && (
                              <button
                                type="button"
                                aria-label={expanded ? "Свернуть подразделы" : "Показать подразделы"}
                                aria-expanded={expanded}
                                onClick={() => setExpandedSection(expanded ? null : section.id)}
                                className="pointer-events-none grid h-8 w-8 shrink-0 place-items-center text-muted-foreground opacity-0 transition-[opacity,color] duration-200 hover:text-foreground group-hover/spot:pointer-events-auto group-hover/spot:opacity-100 group-focus-within/spot:pointer-events-auto group-focus-within/spot:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 motion-reduce:transition-none"
                              >
                                <ChevronRight
                                  className={`h-4 w-4 transition-transform duration-300 ease-out motion-reduce:transition-none ${
                                    expanded ? "rotate-90" : ""
                                  }`}
                                />
                              </button>
                            )}
                          </Spotlight>
                          {hasSubsections && (
                            <div
                              className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                                expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                              }`}
                            >
                              <div
                                className={`min-h-0 overflow-clip transition-[opacity,visibility] duration-300 ease-out motion-reduce:transition-none ${
                                  expanded ? "opacity-100" : "invisible opacity-0"
                                }`}
                              >
                                <div className="mb-1 ml-[22px] border-l border-border/60 pl-2">
                                  {section.subsections.map((subsection) => {
                                    const subActive = activeSubsection?.id === subsection.id;
                                    return (
                                      <Spotlight key={subsection.id} className="block">
                                        <button
                                          type="button"
                                          aria-current={subActive ? "page" : undefined}
                                          onClick={() => setSearchParams({ section: section.slug, sub: subsection.slug })}
                                          className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
                                            subActive
                                              ? "bg-primary/10 font-semibold text-primary"
                                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                          }`}
                                        >
                                          <span className="truncate">{subsection.name}</span>
                                        </button>
                                      </Spotlight>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* G-сабы */}
              <div className="overflow-clip rounded-[var(--card-radius)] border border-border/70 bg-surface">
                <Spotlight className="block">
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
                </Spotlight>
              </div>

              {/* Подписки */}
              <div className="overflow-clip rounded-[var(--card-radius)] border border-border/70 bg-surface">
                <h3 className="px-3 pt-3 text-[13px] font-semibold text-muted-foreground sm:px-4 sm:pt-4">
                  Подписки
                </h3>
                <div className="p-2 sm:p-2.5">
                  {joinedGomoSubs.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-[13px] text-muted-foreground">Пока нет подписок</p>
                  ) : (
                    joinedGomoSubs.map((sub) => (
                      <Spotlight key={sub.id} className="block">
                        <PrefetchLink
                          to={`/g/${sub.slug}`}
                          className="flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-muted/60"
                        >
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                            <Hash className="h-4 w-4 text-primary" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-semibold leading-5 text-primary">g/{sub.slug}</span>
                            <span className="block text-[13px] leading-5 text-muted-foreground line-clamp-2">{sub.name}</span>
                          </span>
                        </PrefetchLink>
                      </Spotlight>
                    ))
                  )}
                </div>
              </div>

              {/* Капля рандома */}
              <div className="overflow-clip rounded-[var(--card-radius)] border border-border/70 bg-surface">
                <h3 className="px-3 pt-3 text-[13px] font-semibold text-muted-foreground sm:px-4 sm:pt-4">
                  Капля рандома
                </h3>
                <div className="p-2 sm:p-2.5">
                  {gomoSubs.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-[13px] text-muted-foreground">Пока нечего показать</p>
                  ) : (
                    gomoSubs.map((sub) => (
                      <Spotlight key={sub.id} className="block">
                        <PrefetchLink
                          to={`/g/${sub.slug}`}
                          className="flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-muted/60"
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
                      </Spotlight>
                    ))
                  )}
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
