import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/integrations/api/compat";
import { PentagramLoader } from "@/components/PentagramLoader";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { PrivacySection } from "@/components/settings/PrivacySection";
import { SecuritySection } from "@/components/settings/SecuritySection";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { IntegrationsSection } from "@/components/settings/IntegrationsSection";
import NotificationsSettings from "@/components/NotificationsSettings";
import { LivePreview } from "@/components/settings/LivePreview";
import { useAppearanceSettings } from "@/components/settings/useAppearanceSettings";
import { SETTINGS_SECTIONS, getSettingsSection, SettingsSearch, type SearchEntry } from "@/components/settings/SettingsNav";
import { handleNavArrowKeys } from "@/components/settings/navKeyboard";
import { cn } from "@/lib/utils";

/**
 * Settings — the real page now.
 *
 * Six sections (Профиль · Внешний вид · Уведомления · Приватность ·
 * Безопасность · Интеграции) behind one shell: grouped sidebar + visible search
 * on desktop, hub → drill-down on mobile, sticky live preview where it helps.
 *
 * Route: /settings[/:section]?layout=mobile|desktop|wide
 * (`?layout` only exists to pin a mode while developing.)
 */

type ViewMode = "mobile" | "desktop" | "wide";

/**
 * Layout breakpoints, derived from what the columns actually need rather than
 * from generic device buckets.
 *
 *  • mobile  — the sidebar is replaced by the drill-down hub
 *  • desktop — sidebar + a readable content column fit side by side
 *  • wide    — a third column (the live preview) fits too
 *
 * The sidebar is a fixed 220px and the preview 320px (see the grid template
 * below), so "does it fit" is arithmetic, not a guess: it depends on whether
 * the sidebar *plus* a comfortable content column plus the page chrome fit in
 * the window. On a ~820px window the two-column layout already looks right —
 * the old 1024px cutoff threw it away for no reason.
 */
const SIDEBAR_PX = 220;
const PREVIEW_PX = 320;
/** Minimum width a settings column needs to stay readable. */
const MIN_CONTENT_PX = 520;
/** Grid gap between the columns. */
const COLUMN_GAP_PX = 24;
/** `px-4` on each side of the container. */
const PAGE_PADDING_PX = 32;

const DESKTOP_MIN_WIDTH = SIDEBAR_PX + MIN_CONTENT_PX + COLUMN_GAP_PX + PAGE_PADDING_PX; // 796
const WIDE_MIN_WIDTH = DESKTOP_MIN_WIDTH + PREVIEW_PX + COLUMN_GAP_PX; // 1140

const resolveMode = (width: number): ViewMode => {
  if (width < DESKTOP_MIN_WIDTH) return "mobile";
  if (width < WIDE_MIN_WIDTH) return "desktop";
  return "wide";
};

const useViewMode = (override: string | null): ViewMode => {
  const [mode, setMode] = useState<ViewMode>(() =>
    typeof window === "undefined" ? "desktop" : resolveMode(window.innerWidth),
  );
  useEffect(() => {
    const onResize = () => setMode(resolveMode(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  if (override === "mobile" || override === "desktop" || override === "wide") return override;
  return mode;
};

const Settings = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { section } = useParams<{ section?: string }>();

  const layoutOverride = new URLSearchParams(location.search).get("layout");
  const mode = useViewMode(layoutOverride);
  const isMobile = mode === "mobile";
  const showPreview = mode === "wide";

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setLoading(false);
    });
  }, []);

  const appearance = useAppearanceSettings(userId);
  const activeSection = getSettingsSection(section);

  const goToEntry = (entry: SearchEntry) => {
    const target = `/settings/${entry.section}${location.search}`;
    if (location.pathname !== `/settings/${entry.section}`) navigate(target);
    if (entry.anchor) {
      window.setTimeout(() => {
        document.getElementById(entry.anchor as string)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  if (!userId) {
    navigate("/auth");
    return null;
  }

  // Desktop opens straight into the default section.
  if (!section && !isMobile) {
    return <Navigate to={`/settings/appearance${location.search}`} replace />;
  }

  // Unknown/legacy section names (account, posts, …) land on the default one
  // instead of a dead stub screen.
  if (section && !activeSection) {
    return <Navigate to={`/settings/appearance${location.search}`} replace />;
  }

  /* ── Mobile hub (no section selected) ──────────────────────────────────── */
  if (!section && isMobile) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <header className="mb-5 text-center">
          <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.subtitle")}</p>
        </header>

        <SettingsSearch className="mb-4" onNavigate={goToEntry} />

        <div className="space-y-2.5" onKeyDown={handleNavArrowKeys}>
          {SETTINGS_SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                data-nav-item
                onClick={() => navigate(`/settings/${item.id}${location.search}`)}
                className="group flex w-full items-center gap-3.5 rounded-2xl border border-border/60 bg-card/60 px-4 py-4 text-left backdrop-blur-xl transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {t(item.labelKey)}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{t(item.descriptionKey)}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            );
          })}
        </div>
      </main>
    );
  }

  /* ── Desktop shell / mobile drill-down ─────────────────────────────────── */

  const gridTemplateColumns = isMobile
    ? "minmax(0, 1fr)"
    : showPreview && activeSection?.id === "appearance"
      ? `${SIDEBAR_PX}px minmax(0, 1fr) ${PREVIEW_PX}px`
      : `${SIDEBAR_PX}px minmax(0, 1fr)`;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      {isMobile ? (
        <button
          type="button"
          onClick={() => navigate(`/settings${location.search}`)}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("common.back")}
        </button>
      ) : (
        <header className="mb-6">
          <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.subtitle")}</p>
        </header>
      )}

      <div className="grid grid-cols-1 gap-6" style={{ gridTemplateColumns }}>
        {/* Sidebar — desktop only */}
        {!isMobile && (
          <nav className="sticky top-24 self-start">
            <SettingsSearch className="mb-4" onNavigate={goToEntry} />
            <div className="space-y-1" onKeyDown={handleNavArrowKeys}>
              {SETTINGS_SECTIONS.map((item) => {
                const Icon = item.icon;
                const active = activeSection?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-nav-item
                    onClick={() => navigate(`/settings/${item.id}${location.search}`)}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                      active
                        ? "bg-primary/10 font-medium text-primary shadow-[inset_0_0_0_1px_oklch(var(--primary)/0.2)]"
                        : "text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                    <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        )}

        {/* Content */}
        <div className="min-w-0">
          {isMobile && activeSection && <h1 className="mb-4 text-xl font-bold">{t(activeSection.labelKey)}</h1>}

          {activeSection?.id === "appearance" ? (
            <AppearanceSection appearance={appearance} />
          ) : activeSection?.id === "privacy" ? (
            <PrivacySection userId={userId} />
          ) : activeSection?.id === "security" ? (
            <SecuritySection userId={userId} />
          ) : activeSection?.id === "profile" ? (
            <ProfileSection userId={userId} />
          ) : activeSection?.id === "notifications" ? (
            <NotificationsSettings />
          ) : activeSection?.id === "integrations" ? (
            <IntegrationsSection userId={userId} />
          ) : null}
        </div>

        {/* Live preview — appearance on wide screens only */}
        {showPreview && activeSection?.id === "appearance" && (
          <LivePreview
            publishStyle={appearance.publishStyle}
            headerBehavior={appearance.headerBehavior}
          />
        )}
      </div>
    </main>
  );
};

export default Settings;
