import React, { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PrefetchLink } from "@/components/PrefetchLink";
import { api } from "@/integrations/api/compat";
import { useProfileCache } from "@/contexts/ProfileCacheContext";
import { toast } from "sonner";
import { Bookmark, ChevronRight, FileText, Hash, History, Home, Plus, Users, X } from "lucide-react";
import { TermsOfService } from "@/components/TermsOfService";
import { ThreadFeed } from "@/components/ThreadFeed";
import { useSessionTime } from "@/hooks/useSessionTime";
import { useThreadSections } from "@/hooks/useThreadSections";
import { SectionIcon } from "@/components/topic/sectionIcons";
import { SectionThreads } from "@/components/SectionThreads";
import { ThreadFeedSkeleton } from "@/components/skeletons/ContentSkeletons";
import { MyPosts } from "@/components/MyPosts";
import { HistoryView } from "@/components/HistoryView";
import { FavoritesView } from "@/components/FavoritesView";
import { MrRandom } from "@/components/MrRandom";
import { AddTabDialog } from "@/components/AddTabDialog";
import { Spotlight } from "@/components/Spotlight";
import { useSidebarTabsStore } from "@/stores/sidebarTabsStore";
import { PentagramLoader } from "@/components/PentagramLoader";

interface GomoSub {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

const Index = () => {
  const { loadProfile } = useProfileCache();
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
  const { sections, loading: sectionsLoading } = useThreadSections();
  // Custom sidebar tabs (localStorage-backed) + their add-panel.
  const sidebarTabs = useSidebarTabsStore((state) => state.tabs);
  const removeSidebarTab = useSidebarTabsStore((state) => state.removeTab);
  const [addTabOpen, setAddTabOpen] = useState(false);
  // ── URL → view ────────────────────────────────────────────────────────────
  // Everything is path-driven:
  //   /                       feed (or the pinned «домашняя» tab, if any)
  //   /feed                   feed, explicitly
  //   /mine /history /favorites
  //   /c/<раздел>[/<подраздел>]
  // Legacy ?section=&sub=&view=&tab= URLs are redirected below.
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const routeParams = useParams<{ sectionSlug?: string; subSlug?: string }>();
  const routeSectionSlug = routeParams.sectionSlug ?? null;
  const routeSubSlug = routeParams.subSlug ?? null;
  const isSectionRoute = Boolean(routeSectionSlug);

  const explicitView: "feed" | "mine" | "history" | "favorites" | null =
    pathname === "/feed"
      ? "feed"
      : pathname === "/mine"
        ? "mine"
        : pathname === "/history"
          ? "history"
          : pathname === "/favorites"
            ? "favorites"
            : null;

  const activeSection = routeSectionSlug
    ? sections.find((s) => s.slug === routeSectionSlug) ?? null
    : null;
  const activeSubsection =
    activeSection && routeSubSlug
      ? activeSection.subsections.find((ss) => ss.slug === routeSubSlug) ?? null
      : null;

  // On the bare «/» a pinned «домашняя» tab opens instead of the feed.
  const homeTab = sidebarTabs.find((t) => t.isHome) ?? null;
  const useHomeTab = pathname === "/" && !explicitView && !isSectionRoute;
  const tabSection =
    useHomeTab && homeTab
      ? sections.find((s) => s.slug === homeTab.sectionSlug) ?? null
      : null;
  const tabSubsection =
    tabSection && homeTab?.subsectionSlug
      ? tabSection.subsections.find((ss) => ss.slug === homeTab.subsectionSlug) ?? null
      : null;

  // The section view actually shown: an explicitly picked раздел, or a tab's.
  const displaySection = activeSection ?? tabSection;
  const displaySubsection = activeSection ? activeSubsection : tabSubsection;

  // A custom tab is a shortcut to its target раздел, so the tab whose target
  // matches the current path is the active one.
  const matchedTab = isSectionRoute
    ? sidebarTabs.find(
        (t) =>
          t.sectionSlug === routeSectionSlug && (t.subsectionSlug ?? null) === (routeSubSlug ?? null),
      ) ?? null
    : useHomeTab
      ? homeTab
      : null;

  // «Создать тему» keeps the текущий раздел/подраздел so the composer opens
  // already placed there.
  const createTopicHref = displaySection
    ? `/create?section=${encodeURIComponent(displaySection.slug)}${
        displaySubsection ? `&sub=${encodeURIComponent(displaySubsection.slug)}` : ""
      }`
    : "/create";

  // Which view is actually on screen. When a section / tab / «Мои записи» is
  // picked we keep the previous view visible until the new one reports ready,
  // so switching never flashes a skeleton.
  const targetMode: "feed" | "section" | "mine" | "history" | "favorites" =
    isSectionRoute || displaySection ? "section" : explicitView ?? "feed";
  // A раздел path is known synchronously, so its view is the initial one — the
  // feed never mounts (and never fetches) when landing straight on a раздел.
  const [shownMode, setShownMode] = useState<"feed" | "section" | "mine" | "history" | "favorites">(
    () => (isSectionRoute ? "section" : "feed"),
  );
  useEffect(() => {
    if (targetMode === "feed") setShownMode("feed");
  }, [targetMode]);
  const handleSectionReady = useCallback(() => setShownMode("section"), []);
  const handleMineReady = useCallback(() => setShownMode("mine"), []);
  const handleHistoryReady = useCallback(() => setShownMode("history"), []);
  const handleFavoritesReady = useCallback(() => setShownMode("favorites"), []);
  const navigate = useNavigate();

  // Legacy query URLs → path forms (old bookmarks and links).
  useEffect(() => {
    if (isSectionRoute || explicitView) return;

    const legacySection = searchParams.get("section");
    if (legacySection) {
      const sub = searchParams.get("sub");
      navigate(
        `/c/${encodeURIComponent(legacySection)}${sub ? `/${encodeURIComponent(sub)}` : ""}`,
        { replace: true },
      );
      return;
    }

    const legacyView = searchParams.get("view");
    if (legacyView) {
      navigate(legacyView === "feed" ? "/feed" : `/${legacyView}`, { replace: true });
      return;
    }

    // Re-runs once the tabs arrive, so a ?tab= link still resolves.
    const legacyTab = searchParams.get("tab");
    if (legacyTab) {
      const tab = sidebarTabs.find((t) => t.id === legacyTab);
      if (tab) {
        navigate(
          `/c/${encodeURIComponent(tab.sectionSlug)}${
            tab.subsectionSlug ? `/${encodeURIComponent(tab.subsectionSlug)}` : ""
          }`,
          { replace: true },
        );
      }
    }
  }, [isSectionRoute, explicitView, searchParams, sidebarTabs, navigate]);
  
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
      } finally {
        setLoading(false);
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
            {/* The feed is mounted only for feed-ish views — on a раздел path it
                is not fetched at all. During the feed→раздел transition it stays
                mounted (hidden by shownMode) until the section reports ready. */}
            {((!isSectionRoute && !displaySection) || shownMode === "feed") && (
              <div className={shownMode === "feed" ? undefined : "hidden"}>
                <ThreadFeed
                  currentUserId={user?.id}
                  currentUsername={currentUserUsername}
                  currentUserColor={currentUserColor}
                />
              </div>
            )}
            {(isSectionRoute || displaySection) && (
              <div className={shownMode === "section" ? undefined : "hidden"}>
                {displaySection ? (
                  <SectionThreads
                    section={displaySection}
                    subsection={displaySubsection}
                    currentUserId={user?.id ?? null}
                    currentUsername={currentUserUsername}
                    currentUserColor={currentUserColor}
                    onReady={handleSectionReady}
                  />
                ) : sectionsLoading ? (
                  <ThreadFeedSkeleton count={5} />
                ) : (
                  <div className="rounded-[var(--card-radius)] border border-dashed border-border/70 bg-muted/20 py-12 text-center">
                    <p className="text-lg font-medium">Раздел не найден</p>
                    <p className="mt-2 text-sm text-muted-foreground">Возможно, ссылка устарела.</p>
                  </div>
                )}
              </div>
            )}
            {explicitView === "mine" && (
              <div className={shownMode === "mine" ? undefined : "hidden"}>
                <MyPosts
                  currentUserId={user?.id ?? null}
                  currentUsername={currentUserUsername}
                  currentUserColor={currentUserColor}
                  onReady={handleMineReady}
                />
              </div>
            )}
            {explicitView === "history" && (
              <div className={shownMode === "history" ? undefined : "hidden"}>
                <HistoryView
                  currentUserId={user?.id ?? null}
                  currentUsername={currentUserUsername}
                  currentUserColor={currentUserColor}
                  onReady={handleHistoryReady}
                />
              </div>
            )}
            {explicitView === "favorites" && (
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
                  to={createTopicHref}
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
                      onClick={() => navigate(key === "feed" ? "/feed" : `/${key}`)}
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

                {/* Custom tabs (localStorage) + the add button. */}
                {sidebarTabs.map((tab) => {
                  const isActiveTab = matchedTab?.id === tab.id;
                  return (
                    <Spotlight
                      key={tab.id}
                      className={`flex items-center gap-0.5 rounded-lg transition-colors ${
                        isActiveTab ? "bg-primary/10" : "hover:bg-muted/60"
                      }`}
                    >
                      <button
                        type="button"
                        aria-current={isActiveTab ? "page" : undefined}
                        onClick={() =>
                          navigate(
                            `/c/${tab.sectionSlug}${tab.subsectionSlug ? `/${tab.subsectionSlug}` : ""}`,
                          )
                        }
                        className={`flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-sm transition-colors ${
                          isActiveTab
                            ? "font-semibold text-primary"
                            : "text-foreground/80 hover:text-foreground"
                        }`}
                      >
                        {tab.isHome && <Home className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
                        <span className="min-w-0 flex-1 truncate text-left">{tab.label}</span>
                      </button>
                      <button
                        type="button"
                        aria-label="Удалить вкладку"
                        onClick={() => {
                          void removeSidebarTab(tab.id);
                        }}
                        className="pointer-events-none grid h-8 w-8 shrink-0 place-items-center text-muted-foreground opacity-0 transition-[opacity,color] duration-200 hover:text-destructive group-hover/spot:pointer-events-auto group-hover/spot:opacity-100 group-focus-within/spot:pointer-events-auto group-focus-within/spot:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 motion-reduce:transition-none"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </Spotlight>
                  );
                })}

                <Spotlight className="block">
                  <button
                    type="button"
                    onClick={() => setAddTabOpen(true)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    <Plus className="h-4 w-4 shrink-0" />
                    вкладка
                  </button>
                </Spotlight>
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
                              onClick={() => navigate(`/c/${section.slug}`)}
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
                                          onClick={() => navigate(`/c/${section.slug}/${subsection.slug}`)}
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

              {/* Mr. рандомность — random thread / post / profile / comment / g-sub */}
              <MrRandom />
            </div>
          </div>

          </div>
        </div>

      <AddTabDialog
        open={addTabOpen}
        onOpenChange={setAddTabOpen}
        sections={sections}
        loading={sections.length === 0}
      />

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
