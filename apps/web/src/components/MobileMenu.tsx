import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/UserAvatar";
import {
  Menu,
  Hammer,
  LogOut,
  Users,
  Droplets,
  Plus,
  Bookmark,
  ChevronRight,
  FileText,
  History,
  Home,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { HeaderUsername } from "@/components/HeaderUsername";
import { storageUrl } from "@/utils/storage";
import { useQuery } from "@tanstack/react-query";
import { formatDropsLabel } from "@/utils/formatDropsLabel";
import { SectionIcon } from "@/components/topic/sectionIcons";
import { MrRandom } from "@/components/MrRandom";
import { AddTabDialog } from "@/components/AddTabDialog";
import { useThreadSections } from "@/hooks/useThreadSections";
import { useSidebarTabsStore } from "@/stores/sidebarTabsStore";

import type { User as UserFromClient } from "@/integrations/api/client";
import { profileUrl } from "@/utils/entityUrl";

interface MobileMenuProps {
  user: UserFromClient | null;
  isModerator: boolean;
}

interface GomoSubItem {
  id: string;
  slug: string;
  name: string;
}

const ROW_ACTIVE = "bg-primary/10 font-semibold text-primary";
const ROW_IDLE = "text-foreground/80 hover:bg-muted/60 hover:text-foreground";

export const MobileMenu = ({ user, isModerator }: MobileMenuProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [joinedSubs, setJoinedSubs] = useState<GomoSubItem[]>([]);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [addTabOpen, setAddTabOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Sidebar data (fetched lazily — only while the sheet is open).
  const { sections, loading: sectionsLoading } = useThreadSections(open);
  const sidebarTabs = useSidebarTabsStore((state) => state.tabs);
  const removeSidebarTab = useSidebarTabsStore((state) => state.removeTab);

  // Compare against the same URL the link below builds, so a numeric profile
  // link and the active-tab check can never disagree.
  const isOwnProfile = !!user && location.pathname === profileUrl(user);

  // Everything is path-driven now:
  //   /feed /mine /history /favorites   app views
  //   /c/<раздел>[/<подраздел>]         sections
  const onHome = location.pathname === "/";
  const pathParts = location.pathname.split("/").filter(Boolean);
  const isSectionPath = pathParts[0] === "c";
  const routeSection = isSectionPath ? sections.find((s) => s.slug === pathParts[1]) : undefined;
  const sectionSlug = routeSection?.slug ?? null;
  const subSlug = routeSection && pathParts[2] ? pathParts[2] : null;

  const explicitView =
    pathParts[0] === "feed" || pathParts[0] === "mine" || pathParts[0] === "history" || pathParts[0] === "favorites"
      ? pathParts[0]
      : null;

  // Keep the текущий раздел when opening the composer from inside one.
  const createTopicHref = sectionSlug
    ? `/create?section=${encodeURIComponent(sectionSlug)}${
        subSlug ? `&sub=${encodeURIComponent(subSlug)}` : ""
      }`
    : "/create";
  const homeTab = sidebarTabs.find((tab) => tab.isHome) ?? null;
  // A tab is a shortcut to its target раздел — active when the path matches it.
  const matchedTab = sectionSlug
    ? sidebarTabs.find(
        (tab) => tab.sectionSlug === sectionSlug && (tab.subsectionSlug ?? null) === subSlug,
      ) ?? null
    : onHome
      ? homeTab
      : null;
  const feedActive = explicitView === "feed" || (onHome && !homeTab);

  const go = (to: string) => {
    navigate(to);
    setOpen(false);
  };

  const { data: dropsData } = useQuery({
    queryKey: ['user-drops-mobile', user?.id],
    queryFn: async () => {
      const session = await api.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return null;
      const res = await fetch(`/api/v1/user/drops?user_id=${user!.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) return json.data as { drops: number };
      return null;
    },
    enabled: open && !!user?.id,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (user) {
      const loadProfile = async () => {
        const { data } = await api
          .from("profiles")
          .select("username, avatar_url")
          .eq("id", user.id)
          .single();

        if (data) {
          setUsername(data.username as string);
          setAvatarUrl(storageUrl("post-images", data.avatar_url as string | null));
        }
      };
      loadProfile();
    }
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;

    const loadSubSections = async () => {
      const { data: memberships } = await api
        .from("gomosub_memberships")
        .select("board_id")
        .eq("user_id", user.id);
      const joinedBoardIds = (memberships ?? []).map((m) => m.board_id);

      if (joinedBoardIds.length > 0) {
        const { data } = await api
          .from("boards")
          .select("id, slug, name")
          .in("id", joinedBoardIds)
          .order("created_at", { ascending: false })
          .limit(6);
        setJoinedSubs((data as unknown as GomoSubItem[]) ?? []);
      } else {
        setJoinedSubs([]);
      }
    };

    loadSubSections();
  }, [user?.id, open]);

  const handleLogout = async () => {
    await api.auth.signOut();
    toast.success(t('auth.logoutSuccess'));
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        aria-label={t('nav.menu')}
        data-testid="mobile-menu-trigger"
        // Logged in: mobile-only (desktop shows the username in the header).
        // Guest: shown at every size — this menu holds the only login entry.
        className={`${user ? "lg:hidden " : ""}h-8 w-8 p-0 hover:bg-[oklch(var(--foreground)/0.12)] transition-colors`}
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[300px] sm:w-[340px] p-0 flex flex-col">
          <SheetHeader className="px-4 pt-4 pb-3 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
            <SheetTitle className="text-left">{t('nav.menu')}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
            {/* Profile panel: the account for a logged-in user, the login CTA
                for a guest (the header has no separate «Войти» button). */}
            {user ? (
              <Link
                to={profileUrl(user)}
                onClick={() => setOpen(false)}
                className="block"
              >
                <div className="p-4 bg-surface border border-border rounded-lg hover:bg-card/80 transition-colors cursor-pointer">
                  <div className="flex items-start gap-3">
                    <UserAvatar
                      src={avatarUrl}
                      userId={user.id}
                      alt={username || t('common.user')}
                      className="w-12 h-12 flex-shrink-0"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">
                        <HeaderUsername userId={user.id} className="text-base font-semibold" />
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        @{username}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ) : (
              <button
                type="button"
                aria-label="Войдите, чтобы увидеть профиль"
                onClick={() => go("/auth")}
                className="block w-full text-left"
              >
                <div className="p-4 bg-surface border border-border rounded-lg hover:bg-card/80 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <UserAvatar alt="" className="w-12 h-12 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">Войдите, чтобы увидеть профиль</div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        Подписки, избранное и уведомления
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            )}

            {/* Create topic + g-subs */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => go(createTopicHref)}
                className="h-8 shrink-0 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/30 hover:bg-primary/90 hover:text-primary-foreground"
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Создать тему
              </Button>
              <Button
                variant="ghost"
                onClick={() => go("/g")}
                className="h-8 shrink-0 rounded-full border border-border bg-surface px-3 text-xs"
              >
                <Users className="w-3.5 h-3.5 mr-1.5" />
                {t('nav.gomosubs')}
              </Button>
            </div>

            {/* Primary nav + custom tabs */}
            <nav className="overflow-clip rounded-[var(--card-radius)] border border-border/70 bg-surface p-1.5">
              {([
                { key: "feed", label: "Feed", icon: Home, active: feedActive, to: "/feed" },
                { key: "mine", label: "Мои записи", icon: FileText, active: explicitView === "mine", to: "/mine" },
                { key: "history", label: "История", icon: History, active: explicitView === "history", to: "/history" },
                { key: "favorites", label: "Избранное", icon: Bookmark, active: explicitView === "favorites", to: "/favorites" },
              ] as const).map(({ key, label, icon: Icon, active, to }) => (
                <button
                  key={key}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => go(to)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm transition-colors ${active ? ROW_ACTIVE : ROW_IDLE}`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                  {label}
                </button>
              ))}

              {sidebarTabs.map((tab) => {
                const isActiveTab = matchedTab?.id === tab.id;
                return (
                  <div
                    key={tab.id}
                    className={`flex items-center gap-0.5 rounded-lg transition-colors ${isActiveTab ? "bg-primary/10" : ""}`}
                  >
                    <button
                      type="button"
                      aria-current={isActiveTab ? "page" : undefined}
                      onClick={() =>
                        go(
                          `/c/${tab.sectionSlug}${tab.subsectionSlug ? `/${tab.subsectionSlug}` : ""}`,
                        )
                      }
                      className={`flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2.5 text-sm transition-colors ${isActiveTab ? "font-semibold text-primary" : ROW_IDLE}`}
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
                      className="grid h-8 w-8 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setAddTabOpen(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <Plus className="h-4 w-4 shrink-0" />
                вкладка
              </button>
            </nav>

            {/* Разделы */}
            {sections.length > 0 && (
              <div className="overflow-clip rounded-[var(--card-radius)] border border-border/70 bg-surface">
                <h3 className="px-3 pt-3 text-[13px] font-semibold text-muted-foreground sm:px-4 sm:pt-4">
                  Разделы
                </h3>
                <div className="p-1.5">
                  {sections.map((section) => {
                    const hasSubsections = section.subsections.length > 0;
                    const expanded = expandedSection === section.id;
                    const isActive = sectionSlug === section.slug && !subSlug;
                    return (
                      <div key={section.id}>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            aria-current={isActive ? "page" : undefined}
                            onClick={() => go(`/c/${section.slug}`)}
                            className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm transition-colors ${isActive ? ROW_ACTIVE : ROW_IDLE}`}
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
                              className="grid h-8 w-8 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <ChevronRight
                                className={`h-4 w-4 transition-transform duration-300 ${expanded ? "rotate-90" : ""}`}
                              />
                            </button>
                          )}
                        </div>
                        {expanded && hasSubsections && (
                          <div className="mb-1 ml-[22px] border-l border-border/60 pl-2">
                            {section.subsections.map((subsection) => {
                              const subActive = sectionSlug === section.slug && subSlug === subsection.slug;
                              return (
                                <button
                                  key={subsection.id}
                                  type="button"
                                  aria-current={subActive ? "page" : undefined}
                                  onClick={() => go(`/c/${section.slug}/${subsection.slug}`)}
                                  className={`flex w-full items-center rounded-lg px-2.5 py-2 text-[13px] transition-colors ${subActive ? ROW_ACTIVE : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
                                >
                                  <span className="truncate">{subsection.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Mr. рандомность */}
            <MrRandom />

            {/* Подписки */}
            <div className="space-y-2 pt-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('nav.subscriptions')}</div>
              {joinedSubs.length === 0 ? (
                <div className="text-xs text-muted-foreground">{t('nav.noSubscriptions')}</div>
              ) : (
                joinedSubs.map((sub) => (
                  <Link
                    key={sub.id}
                    to={`/g/${sub.slug}`}
                    onClick={() => setOpen(false)}
                    className="block rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
                  >
                    <div className="font-medium text-primary">g/{sub.slug}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">{sub.name}</div>
                  </Link>
                ))
              )}
            </div>

            {/* Drops */}
            {dropsData && (
              <Link to="/wallet" onClick={() => setOpen(false)} className="block">
                <Button variant="ghost" className="w-full justify-start relative group hover:translate-x-0.5 transition-transform duration-200 !hover:bg-primary/10 !hover:text-primary">
                  <Droplets className="w-4 h-4 mr-2" />
                  {t('nav.drops')}
                  <span className="ml-auto text-sm text-muted-foreground">{dropsData.drops} {formatDropsLabel(dropsData.drops)}</span>
                </Button>
              </Link>
            )}

            {/* Moderation */}
            {isModerator && (
              <Link to="/moderation" onClick={() => setOpen(false)} className="block">
                <Button variant="ghost" className="w-full justify-start relative group hover:translate-x-0.5 transition-transform duration-200 !hover:bg-primary/10 !hover:text-primary">
                  <Hammer className="w-4 h-4 mr-2" />
                  {t('nav.moderation')}
                </Button>
              </Link>
            )}
          </div>

          {isOwnProfile && (
            <div className="border-t border-border p-4 bg-background/95 backdrop-blur">
              <Button
                variant="ghost"
                className="w-full justify-start relative group !hover:bg-red-500/10 !hover:text-red-500"
                onClick={handleLogout}
              >
                <LogOut className="w-4 h-4 mr-2" />
                {t('nav.logoutFull')}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AddTabDialog
        open={addTabOpen}
        onOpenChange={setAddTabOpen}
        sections={sections}
        loading={sectionsLoading}
      />
    </>
  );
};
