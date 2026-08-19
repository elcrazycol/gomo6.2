import { useEffect, lazy, type ComponentType } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner, toast } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LazyPage } from "@/components/LazyPage";
import { AuthGuard } from "@/components/AuthGuard";
import { applyTheme, getStoredTheme, syncSharedAppearanceCookies } from "@/utils/theme";
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
const Moderation = lazyWithRetry(() => import("./pages/Moderation"));
const ModerationPosts = lazyWithRetry(() => import("./pages/ModerationPosts"));
const EmojiModeration = lazyWithRetry(() => import("./pages/EmojiModeration"));
const EmojiCreate = lazyWithRetry(() => import("./pages/EmojiCreate"));
const EmojiEdit = lazyWithRetry(() => import("./pages/EmojiEdit"));
const EmojiEditForm = lazyWithRetry(() => import("./pages/EmojiEditForm"));
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
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
const Translate = lazyWithRetry(() => import("./pages/Translate"));

// Prefetch critical routes on app start
const prefetchRoutes = () => {
  // Prefetch main routes after initial load
  setTimeout(() => {
    import("./pages/Auth").catch(() => {});
    import("./pages/Settings").catch(() => {});
    import("./pages/Profile").catch(() => {});
  }, 2000);
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes - data stays fresh
      gcTime: 10 * 60 * 1000, // 10 minutes - cache retention
      refetchOnWindowFocus: false, // Don't refetch on window focus
      refetchOnMount: false, // Don't refetch on component mount if data is fresh
      retry: 1, // Only retry once on failure
    },
  },
});

const App = () => {
  useEffect(() => {
    // Resolve the active UI language (server profile → local → default) and
    // overlay community translations before the first meaningful paint.
    useLanguageStore.getState().initialize();
  }, []);

  useEffect(() => {
    // Prefetch critical routes for instant navigation
    prefetchRoutes();
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
    // Apply saved theme immediately to prevent layout flash
    const { colorTheme, isDarkMode } = getStoredTheme();
    applyTheme(colorTheme, isDarkMode);

    // Apply saved custom font
    const savedFont = localStorage.getItem('custom_font');
    if (savedFont) {
      // Load Google Font
      const link = document.createElement('link');
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(savedFont)}:wght@400;500;600;700&display=swap`;
      link.rel = 'stylesheet';
      link.setAttribute('data-google-font', 'true');
      document.head.appendChild(link);

      // Apply font
      const fontFamily = `"${savedFont}", system-ui, -apple-system, sans-serif`;
      document.documentElement.style.setProperty('--font-family', fontFamily);
      document.body.style.fontFamily = fontFamily;
    }

    syncSharedAppearanceCookies();

    const handleStorage = () => {
      syncSharedAppearanceCookies();
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ProfileCacheProvider>
          <LikesCacheProvider>
            <EmojiDataProvider>
              <TooltipProvider>
                <Toaster />
                <Sonner />
                <BrowserRouter>
                  <Routes>
                    {/* Special pages without layout */}
                    <Route path="/auth" element={<LazyPage component={Auth} />} />
                    <Route path="/oauth/consent" element={<LazyPage component={OAuthConsent} />} />

                    {/* Pages with layout */}
                    <Route path="/" element={<AppLayout><Outlet /></AppLayout>}>
                      <Route index element={<LazyPage component={Index} />} />
                      <Route path="messages" element={<AuthGuard><LazyPage component={Messages} /></AuthGuard>} />
                      <Route path="achievements/:userId" element={<LazyPage component={Achievements} />} />
                      <Route path="profile/:userId/wall/:postId" element={<LazyPage component={WallPost} />} />
                      <Route path="profile/:userId" element={<LazyPage component={Profile} />} />
                      <Route path="moderation" element={<AuthGuard><LazyPage component={Moderation} /></AuthGuard>} />
                      <Route path="moderation/posts" element={<AuthGuard><LazyPage component={ModerationPosts} /></AuthGuard>} />
                      <Route path="moderation/emojis" element={<AuthGuard><LazyPage component={EmojiModeration} /></AuthGuard>} />
                      <Route path="moderation/emojis/create" element={<AuthGuard><LazyPage component={EmojiCreate} /></AuthGuard>} />
                      <Route path="moderation/emojis/edit" element={<AuthGuard><LazyPage component={EmojiEdit} /></AuthGuard>} />
                      <Route path="moderation/emojis/edit/:emojiId" element={<AuthGuard><LazyPage component={EmojiEditForm} /></AuthGuard>} />
                      <Route path="emojis" element={<LazyPage component={EmojiPacks} />} />
                      <Route path="emojis/pack/:slug" element={<LazyPage component={EmojiPackDetail} />} />
                      <Route path="emojis/create" element={<AuthGuard><LazyPage component={EmojiPackCreate} /></AuthGuard>} />
                      <Route path="emojis/my" element={<AuthGuard><LazyPage component={EmojiMyPacks} /></AuthGuard>} />
                      <Route path="emojis/edit/:id" element={<AuthGuard><LazyPage component={EmojiPackEdit} /></AuthGuard>} />
                      <Route path="settings/prof-studio" element={<AuthGuard><LazyPage component={ProfileStudio} /></AuthGuard>} />
                      {/* Legacy URL — the studio replaced /settings/custom */}
                      <Route path="settings/custom" element={<AuthGuard><Navigate to="/settings/prof-studio" replace /></AuthGuard>} />
                      <Route path="settings/placeholders" element={<AuthGuard><LazyPage component={Placeholders} /></AuthGuard>} />
                      <Route path="settings/:section" element={<AuthGuard><LazyPage component={Settings} /></AuthGuard>} />
                      <Route path="settings" element={<AuthGuard><LazyPage component={Settings} /></AuthGuard>} />
                      <Route path="stats" element={<AuthGuard><LazyPage component={Stats} /></AuthGuard>} />
                      <Route path="wallet" element={<AuthGuard><LazyPage component={Wallet} /></AuthGuard>} />
                      <Route path="notify" element={<AuthGuard><LazyPage component={Notify} /></AuthGuard>} />
                      <Route path="notify/wall-likes/:notificationId" element={<AuthGuard><LazyPage component={NotificationLikes} /></AuthGuard>} />
                      <Route path="translate" element={<AuthGuard><LazyPage component={Translate} /></AuthGuard>} />
                      <Route path="search" element={<LazyPage component={SearchResults} />} />
                      <Route path="gomosubs" element={<LazyPage component={GomoSubs} />} />
                      <Route path="g" element={<LazyPage component={GomoSubs} />} />
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
                      <Route path=":slug" element={<LazyPage component={Board} />} />
                      <Route path=":slug/thread/:threadId" element={<LazyPage component={Thread} />} />
                    </Route>

                    {/* Catch-all */}
                    <Route path="*" element={<AppLayout><LazyPage component={NotFound} /></AppLayout>} />
                  </Routes>
                </BrowserRouter>
              </TooltipProvider>
            </EmojiDataProvider>
          </LikesCacheProvider>
        </ProfileCacheProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
};

export default App;
