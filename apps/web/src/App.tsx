import { useEffect, useRef, lazy, type ComponentType } from "react";
import { Toaster as Sonner, toast } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/integrations/api/queryClient";
import { BrowserRouter, Routes, Route, Outlet, Navigate, useLocation, useNavigationType, type Location } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LazyPage } from "@/components/LazyPage";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessengerFallbackHero,
  MessengerFallbackSidebar,
  ProfileSkeleton,
  StoriesRailSkeleton,
  ThreadFeedSkeleton,
} from "@/components/skeletons/ContentSkeletons";
import { AuthGuard } from "@/components/AuthGuard";
import { VideoEditorHost } from "@/components/VideoEditorHost";
import { StoryComposer } from "@/components/stories/StoryComposer";
import { StoryViewer } from "@/components/stories/StoryViewer";
import { ThemeSync } from "@/components/ThemeSync";
import { QuestUnlockOverlay } from "@/components/QuestUnlockOverlay";
import { applyTheme, getStoredPrefs, syncSharedAppearanceCookies, watchSystemMode } from "@/theme";
import { applyCustomFont, getStoredCustomFont } from "@/lib/customFont";
import { MotionGate } from "@/hooks/MotionGate";
// Registers the per-route data preloaders (intent prefetch).
import "@/routes/data";
import { wsService } from "./services/websocket";
import { useSpotifyAuthorPolling } from "@/hooks/useSpotifyAuthorPolling";
import { ProfileCacheProvider } from "@/contexts/ProfileCacheContext";
import { LikesCacheProvider } from "@/contexts/LikesCacheContext";
import { EmojiDataProvider } from "@/contexts/EmojiDataContext";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { logClientError } from "@/lib/logging";
import { useLanguageStore } from "@/stores/languageStore";

// Helper: load a page with retry. If a dynamic chunk fails (stale
// deployment, network blip, ad blocker), reload the page once to fetch
// the latest index.html + chunks.
const lazyWithRetry = (
  factory: () => Promise<{ default: ComponentType<any> }>
) => {
  return lazy(async () => {
    try {
      const module = await factory();
      // Chunk loaded successfully: clear any stale-reload flag.
      try {
        window.sessionStorage.removeItem('gomo6-chunk-reload-tried');
      } catch {
        // ignore
      }
      return module;
    } catch (error) {
      const hasRetried = (() => {
        try {
          return window.sessionStorage.getItem('gomo6-chunk-reload-tried') === 'true';
        } catch {
          return false;
        }
      })();

      if (!hasRetried) {
        try {
          window.sessionStorage.setItem('gomo6-chunk-reload-tried', 'true');
        } catch {
          // ignore
        }
        // A stale chunk after a deploy is expected and self-healing: reload
        // once to fetch the latest index.html + chunks. Not an error — the
        // auto-reload is the recovery, so don't spam client_errors with it.
        window.location.reload();
        // Keep Suspense alive while the page reloads.
        return new Promise<never>(() => {});
      }

      // Second failure in a row — a real problem. Log it and propagate so
      // the error boundary can show UI.
      logClientError(error, 'dynamic_import_failed', {
        href: window.location.href,
      });
      throw error;
    }
  });
};

// Lazy load pages for better performance
const Index = lazyWithRetry(() => import("./pages/Index"));
const CreateThread = lazyWithRetry(() => import("./pages/CreateThread"));
const CreateGomoThread = lazyWithRetry(() => import("./pages/CreateGomoThread"));
const Auth = lazyWithRetry(() => import("./pages/Auth"));
const Board = lazyWithRetry(() => import("./pages/Board"));
const Thread = lazyWithRetry(() => import("./pages/Thread"));
const Profile = lazyWithRetry(() => import("./pages/Profile"));
const WallPost = lazyWithRetry(() => import("./pages/WallPost"));
const ModerationDashboard = lazyWithRetry(() => import("./pages/ModerationDashboard"));
const ModerationPosts = lazyWithRetry(() => import("./pages/ModerationPosts"));
const ModerationAudit = lazyWithRetry(() => import("./pages/ModerationAudit"));
const ModerationUser = lazyWithRetry(() => import("./pages/ModerationUser"));
const ModerationAppeals = lazyWithRetry(() => import("./pages/ModerationAppeals"));
const ModerationStaff = lazyWithRetry(() => import("./pages/ModerationStaff"));
const ModerationReport = lazyWithRetry(() => import("./pages/ModerationReport"));
const ModerationAction = lazyWithRetry(() => import("./pages/ModerationAction"));
const Appeals = lazyWithRetry(() => import("./pages/Appeals"));
const EmojiPacks = lazyWithRetry(() => import("./pages/EmojiPacks"));
const EmojiPackDetail = lazyWithRetry(() => import("./pages/EmojiPackDetail"));
const EmojiPackCreate = lazyWithRetry(() => import("./pages/EmojiPackCreate"));
const EmojiPackEdit = lazyWithRetry(() => import("./pages/EmojiPackEdit"));
const EmojiMyPacks = lazyWithRetry(() => import("./pages/EmojiMyPacks"));
const Messages = lazyWithRetry(() => import("./pages/Messages"));
const Settings = lazyWithRetry(() => import("./pages/Settings"));
const ProfileStudio = lazyWithRetry(() => import("./pages/settings/ProfileStudio"));
const Placeholders = lazyWithRetry(() => import("./pages/settings/Placeholders"));
const GomoSubs = lazyWithRetry(() => import("./pages/GomoSubs"));
const GomoSubCreate = lazyWithRetry(() => import("./pages/GomoSubCreate"));
const GomoSubSettings = lazyWithRetry(() => import("./pages/GomoSubSettings"));
const GomoSubJoin = lazyWithRetry(() => import("./pages/GomoSubJoin"));
const SearchResults = lazyWithRetry(() => import("./pages/SearchResults"));
const Stats = lazyWithRetry(() => import("./pages/Stats"));
const Wallet = lazyWithRetry(() => import("./pages/Wallet"));
const Notify = lazyWithRetry(() => import("./pages/Notify"));
const NotificationLikes = lazyWithRetry(() => import("./pages/NotificationLikes"));
const OAuthConsent = lazyWithRetry(() => import("./pages/OAuthConsent"));
const Achievements = lazyWithRetry(() => import("./pages/Achievements"));
const DailyQuests = lazyWithRetry(() => import("./pages/DailyQuests"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
const Translate = lazyWithRetry(() => import("./pages/Translate"));
// Правовые документы грузим лениво: это тексты, а не критичный путь.
const Legal = lazyWithRetry(() => import("./pages/Legal"));

/**
 * The reworked Settings page lived at /settings-v2 while it was a prototype.
 * Keep those URLs working (bookmarks, open tabs) by forwarding to the real
 * route with the same section and query string.
 */
const LegacySettingsRedirect = () => {
  const location = useLocation();
  const section = location.pathname.replace(/^\/settings-v2/, "");
  return <Navigate to={`/settings${section}${location.search}`} replace />;
};

const App = () => {
  useEffect(() => {
    // Resolve the active UI language (server profile → local → default) and
    // overlay community translations before the first meaningful paint.
    useLanguageStore.getState().initialize();
  }, []);

  // Global network error handler — show toast for unhandled fetch failures
  useEffect(() => {
    let errorTimeout: ReturnType<typeof setTimeout>;
    const showToast = (msg: string) => {
      clearTimeout(errorTimeout);
      errorTimeout = setTimeout(() => toast.error(msg), 500);
    };

    const handler = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (reason instanceof TypeError && reason.message === 'Failed to fetch') {
        showToast('Ошибка сети. Проверьте подключение к интернету.');
      } else if (reason?.message?.includes('NetworkError') || reason?.message?.includes('network')) {
        showToast('Ошибка сети. Проверьте подключение к интернету.');
      }
    };

    window.addEventListener('unhandledrejection', handler);
    return () => {
      window.removeEventListener('unhandledrejection', handler);
      clearTimeout(errorTimeout);
    };
  }, []);

  // Drive real-time Spotify now-playing for profile visitors
  useSpotifyAuthorPolling();

  useEffect(() => {
    // Connect to WebSocket for real-time updates
    wsService.connect();
    
    // Wait for connection then subscribe to feed
    const checkAndSubscribe = () => {
      if (wsService.connected) {
        wsService.subscribeToFeed();
      } else {
        setTimeout(checkAndSubscribe, 500);
      }
    };
    checkAndSubscribe();
    
    // Note: We don't disconnect on unmount to keep connection alive across navigation
  }, []);

  useEffect(() => {
    // The pre-boot script already painted the theme; this keeps it in sync
    // across tabs and follows the OS scheme when the preference is "system".
    const { theme, mode } = getStoredPrefs();
    applyTheme(theme, mode);

    // Apply saved custom font
    const savedFont = getStoredCustomFont();
    if (savedFont) applyCustomFont(savedFont);

    const reapply = () => {
      const prefs = getStoredPrefs();
      applyTheme(prefs.theme, prefs.mode);
      syncSharedAppearanceCookies();
    };

    syncSharedAppearanceCookies();

    const handleStorage = (event: StorageEvent) => {
      if (event.key == null || event.key === "color-theme" || event.key === "theme-mode" || event.key === "dark-mode") {
        reapply();
      }
    };

    window.addEventListener("storage", handleStorage);
    const unwatchSystem = watchSystemMode(reapply);

    return () => {
      window.removeEventListener("storage", handleStorage);
      unwatchSystem();
    };
  }, []);

  return (
    <AppErrorBoundary>
      {/* One motion contract for the whole app. Two layers: when the OS asks
          for reduced motion framer keeps opacity and drops the rest; when the
          user picks «Без анимации» in Settings the springs stop entirely. */}
      <MotionGate>
      <QueryClientProvider client={queryClient}>
        <ProfileCacheProvider>
          <LikesCacheProvider>
            <EmojiDataProvider>
              <TooltipProvider>
                <Sonner />
                <BrowserRouter>
                  <ThemeSync />
                  <QuestUnlockOverlay />
                  <AppRoutes />
                  {/* Stories: both live at the router root so the viewer can
                      deep-link to the messenger on reply; dialogs portal to body. */}
                  <StoryComposer />
                  <StoryViewer />
                </BrowserRouter>
                <VideoEditorHost />
              </TooltipProvider>
            </EmojiDataProvider>
          </LikesCacheProvider>
        </ProfileCacheProvider>
      </QueryClientProvider>
      </MotionGate>
    </AppErrorBoundary>
  );
};

// Chunk-level fallbacks: shaped per main tab (same skeletons the pages show
// for cold data), so even a cold first visit lands on a layout-matching
// frame instead of a full-screen spinner. Data-cold states are handled inside
// the pages themselves.
const FeedFallback = () => (
  <div className="bg-background min-h-screen">
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex flex-col lg:grid lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <StoriesRailSkeleton />
          <ThreadFeedSkeleton />
        </div>
        <div className="hidden lg:block lg:col-span-1" aria-hidden="true" />
      </div>
    </div>
  </div>
);

const MessagesFallback = () => (
  // Self-sufficient: Tailwind only, no .messenger-* classes — the chunk CSS
  // is not here yet when this paints. Mirrors .messenger-app: bordered card
  // on desktop, fixed full-viewport surface on phones (≤980px) — without the
  // fixed positioning the in-flow offset stacks with the pill's own
  // header+10 margin and the search lands too low.
  <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background min-[981px]:rounded-[var(--radius)] min-[981px]:border max-[980px]:fixed max-[980px]:inset-0 max-[980px]:overflow-x-hidden" aria-hidden="true">
    <div className="grid min-h-0 w-full flex-1 grid-cols-1 min-[981px]:grid-cols-[320px_minmax(0,1fr)]">
      <MessengerFallbackSidebar />
      <MessengerFallbackHero />
    </div>
  </div>
);

const GomoSubsFallback = () => (
  <div className="max-w-6xl mx-auto w-full px-3 sm:px-5">
    {/* search + view controls strip */}
    <div className="sticky top-[var(--app-header-pad,60px)] z-30 py-2.5" aria-hidden="true">
      <div className="rounded-2xl border border-border/50 bg-surface/85 p-2 shadow-sm">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 flex-1 rounded-full" pulse={false} />
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" pulse={false} />
        </div>
      </div>
    </div>
    {/* joined rail */}
    <section aria-hidden="true">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" pulse={false} />
        <Skeleton className="h-8 w-8 rounded-full" pulse={false} />
      </div>
      <div className="mt-2 flex gap-2 overflow-hidden pb-1">
        {[112, 96, 120].map((w, i) => (
          <span
            key={i}
            className="flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-surface py-1.5 pl-2 pr-3.5"
          >
            <Skeleton className="h-7 w-7 rounded-full" pulse={false} />
            <Skeleton className="h-4" style={{ width: w }} pulse={false} />
          </span>
        ))}
      </div>
    </section>
    {/* catalog grid */}
    <main className="mt-4 pb-10">
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-border/70 bg-surface">
            <Skeleton className="h-24 w-full rounded-none sm:h-28" pulse={false} />
            <div className="space-y-2.5 px-4 pb-4 pt-10">
              <Skeleton className="h-4 w-2/3" pulse={false} />
              <Skeleton className="h-3 w-1/3" pulse={false} />
              <Skeleton className="h-3 w-full" pulse={false} />
            </div>
          </div>
        ))}
      </div>
    </main>
  </div>
);

const ProfileFallback = () => (
  <div className="mx-auto p-4" style={{ maxWidth: 672 }}>
    <ProfileSkeleton />
  </div>
);

// Shared element so every feed-ish route shows the same chunk fallback.
const feedFallback = <FeedFallback />;

// The route tree. Wall posts opened from the profile/feed use the "background
// location" pattern: the previous page (profile or feed) is kept mounted under
// the post, and the post renders as a full-screen overlay that can be dragged
// away over it. A direct link falls back to the plain in-layout page.
function AppRoutes() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const backgroundLocation = (location.state as { backgroundLocation?: Location } | null)?.backgroundLocation ?? null;

  const prevPathRef = useRef(location.pathname);

  // Instant navigation: the URL and the view swap in the same commit — the
  // previous screen is never held. First paint comes from cache (intent
  // prefetch + per-page synchronous peeks) or a shaped skeleton; the header
  // loading bar covers the streaming rest. PUSH to a new path resets the
  // scroll (native-app feel); POP keeps it, overlays never scroll the page.
  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = location.pathname;
    if (backgroundLocation) return;
    if (navigationType !== "PUSH") return;
    if (prev === location.pathname) return;
    window.scrollTo(0, 0);
  }, [location, backgroundLocation, navigationType]);

  return (
    <>
      <Routes location={backgroundLocation ?? location}>
        {/* Special pages without layout */}
        <Route path="/auth" element={<LazyPage component={Auth} />} />
        <Route path="/oauth/consent" element={<LazyPage component={OAuthConsent} />} />

        {/* Pages with layout */}
        <Route path="/" element={<AppLayout><Outlet /></AppLayout>}>
          <Route index element={<LazyPage component={Index} fallback={feedFallback} />} />
          {/* App views and разделы as real paths. «c» = category, the
              Discourse-style prefix for a category→subcategory hierarchy (our
              раздел→подраздел). It also keeps раздел slugs out of the reserved
              top-level namespace (/search, /create, /settings, /thread, …), so
              no slug can ever shadow a route. */}
          <Route path="feed" element={<LazyPage component={Index} fallback={feedFallback} />} />
          <Route path="mine" element={<LazyPage component={Index} fallback={feedFallback} />} />
          <Route path="history" element={<LazyPage component={Index} fallback={feedFallback} />} />
          <Route path="favorites" element={<LazyPage component={Index} fallback={feedFallback} />} />
          <Route path="c/:sectionSlug" element={<LazyPage component={Index} fallback={feedFallback} />} />
          <Route path="c/:sectionSlug/:subSlug" element={<LazyPage component={Index} fallback={feedFallback} />} />
          <Route path="messages" element={<AuthGuard><LazyPage component={Messages} fallback={<MessagesFallback />} /></AuthGuard>} />
          {/* Static first: /achievements/daily must not be read as a userId. */}
          <Route path="achievements/daily" element={<LazyPage component={DailyQuests} />} />
          <Route path="achievements/:userId" element={<LazyPage component={Achievements} />} />
          <Route path="profile/:userId/wall/:postId" element={<LazyPage component={WallPost} />} />
          <Route path="profile/:userId" element={<LazyPage component={Profile} fallback={<ProfileFallback />} />} />
          <Route path="moderation" element={<AuthGuard><LazyPage component={ModerationDashboard} /></AuthGuard>} />
          <Route path="moderation/reports" element={<AuthGuard><LazyPage component={ModerationPosts} /></AuthGuard>} />
          <Route path="moderation/reports/:reportId" element={<AuthGuard><LazyPage component={ModerationReport} /></AuthGuard>} />
          <Route path="moderation/audit" element={<AuthGuard><LazyPage component={ModerationAudit} /></AuthGuard>} />
          <Route path="moderation/actions/:actionId" element={<AuthGuard><LazyPage component={ModerationAction} /></AuthGuard>} />
          <Route path="moderation/users/:userId" element={<AuthGuard><LazyPage component={ModerationUser} /></AuthGuard>} />
          <Route path="moderation/appeals" element={<AuthGuard><LazyPage component={ModerationAppeals} /></AuthGuard>} />
          <Route path="moderation/staff" element={<AuthGuard><LazyPage component={ModerationStaff} /></AuthGuard>} />
          <Route path="appeals" element={<AuthGuard><LazyPage component={Appeals} /></AuthGuard>} />
          {/* Legacy URL — the queue lives at /moderation/reports now. */}
          <Route path="moderation/posts" element={<Navigate to="/moderation/reports" replace />} />
          <Route path="emojis" element={<LazyPage component={EmojiPacks} />} />
          <Route path="emojis/pack/:slug" element={<LazyPage component={EmojiPackDetail} />} />
          <Route path="emojis/create" element={<AuthGuard><LazyPage component={EmojiPackCreate} /></AuthGuard>} />
          <Route path="emojis/my" element={<AuthGuard><LazyPage component={EmojiMyPacks} /></AuthGuard>} />
          <Route path="emojis/edit/:id" element={<AuthGuard><LazyPage component={EmojiPackEdit} /></AuthGuard>} />
          <Route path="settings/prof-studio" element={<AuthGuard><LazyPage component={ProfileStudio} /></AuthGuard>} />
          {/* Legacy URL — the studio replaced /settings/custom */}
          <Route path="settings/custom" element={<AuthGuard><Navigate to="/settings/prof-studio" replace /></AuthGuard>} />
          <Route path="settings/placeholders" element={<AuthGuard><LazyPage component={Placeholders} /></AuthGuard>} />
          {/* Legacy section names from the old tabbed page */}
          <Route path="settings/account" element={<AuthGuard><Navigate to="/settings/security" replace /></AuthGuard>} />
          <Route path="settings/posts" element={<AuthGuard><Navigate to="/settings/profile" replace /></AuthGuard>} />
          {/* The reworked page (was /settings-v2 during the rewrite) */}
          <Route path="settings-v2" element={<LegacySettingsRedirect />} />
          <Route path="settings-v2/:section" element={<LegacySettingsRedirect />} />
          <Route path="settings/:section" element={<AuthGuard><LazyPage component={Settings} /></AuthGuard>} />
          <Route path="settings" element={<AuthGuard><LazyPage component={Settings} /></AuthGuard>} />
          <Route path="stats" element={<AuthGuard><LazyPage component={Stats} /></AuthGuard>} />
          <Route path="wallet" element={<AuthGuard><LazyPage component={Wallet} /></AuthGuard>} />
          <Route path="notify" element={<AuthGuard><LazyPage component={Notify} /></AuthGuard>} />
          <Route path="notify/wall-likes/:notificationId" element={<AuthGuard><LazyPage component={NotificationLikes} /></AuthGuard>} />
          <Route path="translate" element={<AuthGuard><LazyPage component={Translate} /></AuthGuard>} />
          <Route path="search" element={<LazyPage component={SearchResults} />} />
          {/* Правовые документы: /legal и /legal/:docId */}
          <Route path="legal" element={<LazyPage component={Legal} />} />
          <Route path="legal/:docId" element={<LazyPage component={Legal} />} />
          <Route path="gomosubs" element={<LazyPage component={GomoSubs} fallback={<GomoSubsFallback />} />} />
          <Route path="g" element={<LazyPage component={GomoSubs} fallback={<GomoSubsFallback />} />} />
          <Route path="g/create" element={<AuthGuard><LazyPage component={GomoSubCreate} /></AuthGuard>} />
          <Route path="g/:slug/create" element={<AuthGuard><LazyPage component={CreateGomoThread} /></AuthGuard>} />
          <Route path="g/:slug/c/:channelSlug/create" element={<AuthGuard><LazyPage component={CreateGomoThread} /></AuthGuard>} />
          <Route path="g/:slug/settings" element={<AuthGuard><LazyPage component={GomoSubSettings} /></AuthGuard>} />
          <Route path="g/:slug/join/:code" element={<LazyPage component={GomoSubJoin} />} />
          <Route path="create" element={<AuthGuard><LazyPage component={CreateThread} /></AuthGuard>} />
          <Route path="g/:slug/thread/:threadId" element={<LazyPage component={Thread} />} />
          <Route path="g/:slug/c/:channelSlug/thread/:threadId" element={<LazyPage component={Thread} />} />
          <Route path="g/:slug/c/:channelSlug" element={<LazyPage component={Board} />} />
          <Route path="g/:slug" element={<LazyPage component={Board} />} />
          <Route path="thread/:threadId" element={<LazyPage component={Thread} />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<AppLayout><LazyPage component={NotFound} /></AppLayout>} />
      </Routes>

      {backgroundLocation && (
        // Overlays keep the previous page mounted underneath: wall posts and
        // the topic composers open as panels over the feed/board instead of
        // swapping the page out. A direct link falls back to the plain
        // in-layout page above.
        <Routes location={location}>
          <Route path="/profile/:userId/wall/:postId" element={<LazyPage component={WallPost} />} />
          <Route path="/create" element={<AuthGuard><LazyPage component={CreateThread} /></AuthGuard>} />
          <Route path="/g/:slug/create" element={<AuthGuard><LazyPage component={CreateGomoThread} /></AuthGuard>} />
          <Route path="/g/:slug/c/:channelSlug/create" element={<AuthGuard><LazyPage component={CreateGomoThread} /></AuthGuard>} />
        </Routes>
      )}
    </>
  );
};

export default App;
