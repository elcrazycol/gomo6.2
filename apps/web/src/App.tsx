import { useEffect, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner, toast } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
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

// Lazy load pages for better performance
const Index = lazy(() => import("./pages/Index"));
const CreateThread = lazy(() => import("./pages/CreateThread"));
const CreateGomoThread = lazy(() => import("./pages/CreateGomoThread"));
const Auth = lazy(() => import("./pages/Auth"));
const Board = lazy(() => import("./pages/Board"));
const Thread = lazy(() => import("./pages/Thread"));
const Profile = lazy(() => import("./pages/Profile"));
const WallPost = lazy(() => import("./pages/WallPost"));
const Moderation = lazy(() => import("./pages/Moderation"));
const ModerationPosts = lazy(() => import("./pages/ModerationPosts"));
const EmojiModeration = lazy(() => import("./pages/EmojiModeration"));
const EmojiCreate = lazy(() => import("./pages/EmojiCreate"));
const EmojiEdit = lazy(() => import("./pages/EmojiEdit"));
const EmojiEditForm = lazy(() => import("./pages/EmojiEditForm"));
const EmojiPacks = lazy(() => import("./pages/EmojiPacks"));
const EmojiPackDetail = lazy(() => import("./pages/EmojiPackDetail"));
const EmojiPackCreate = lazy(() => import("./pages/EmojiPackCreate"));
const EmojiPackEdit = lazy(() => import("./pages/EmojiPackEdit"));
const EmojiMyPacks = lazy(() => import("./pages/EmojiMyPacks"));
const Messages = lazy(() => import("./pages/Messages"));
const Settings = lazy(() => import("./pages/Settings"));
const CustomProfile = lazy(() => import("./pages/settings/CustomProfile"));
const Placeholders = lazy(() => import("./pages/settings/Placeholders"));
const GomoSubs = lazy(() => import("./pages/GomoSubs"));
const GomoSubCreate = lazy(() => import("./pages/GomoSubCreate"));
const GomoSubSettings = lazy(() => import("./pages/GomoSubSettings"));
const GomoSubJoin = lazy(() => import("./pages/GomoSubJoin"));
const SearchResults = lazy(() => import("./pages/SearchResults"));
const Stats = lazy(() => import("./pages/Stats"));
const Wallet = lazy(() => import("./pages/Wallet"));
const Notify = lazy(() => import("./pages/Notify"));
const OAuthConsent = lazy(() => import("./pages/OAuthConsent"));
const Achievements = lazy(() => import("./pages/Achievements"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Prefetch critical routes on app start
const prefetchRoutes = () => {
  // Prefetch main routes after initial load
  setTimeout(() => {
    import("./pages/Auth");
    import("./pages/Settings");
    import("./pages/Profile");
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
                <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
                      <Route path="settings/custom" element={<AuthGuard><LazyPage component={CustomProfile} /></AuthGuard>} />
                      <Route path="settings/placeholders" element={<AuthGuard><LazyPage component={Placeholders} /></AuthGuard>} />
                      <Route path="settings/:section" element={<AuthGuard><LazyPage component={Settings} /></AuthGuard>} />
                      <Route path="settings" element={<AuthGuard><LazyPage component={Settings} /></AuthGuard>} />
                      <Route path="stats" element={<AuthGuard><LazyPage component={Stats} /></AuthGuard>} />
                      <Route path="wallet" element={<AuthGuard><LazyPage component={Wallet} /></AuthGuard>} />
                      <Route path="notify" element={<AuthGuard><LazyPage component={Notify} /></AuthGuard>} />
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
