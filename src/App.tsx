import { useEffect, useState, lazy, memo } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { LazyPage } from "@/components/LazyPage";

// Lazy load pages for better performance
const Index = lazy(() => import("./pages/Index"));
const BoardsView = lazy(() => import("./pages/BoardsView"));
const CreateThread = lazy(() => import("./pages/CreateThread"));
const Auth = lazy(() => import("./pages/Auth"));
const Board = lazy(() => import("./pages/Board"));
const Thread = lazy(() => import("./pages/Thread"));
const Profile = lazy(() => import("./pages/Profile"));
const Moderation = lazy(() => import("./pages/Moderation"));
const ModerationPosts = lazy(() => import("./pages/ModerationPosts"));
const EmojiModeration = lazy(() => import("./pages/EmojiModeration"));
const EmojiCreate = lazy(() => import("./pages/EmojiCreate"));
const EmojiEdit = lazy(() => import("./pages/EmojiEdit"));
const EmojiEditForm = lazy(() => import("./pages/EmojiEditForm"));
const Messages = lazy(() => import("./pages/Messages"));
const Settings = lazy(() => import("./pages/Settings"));
const CustomProfile = lazy(() => import("./pages/settings/CustomProfile"));
const Placeholders = lazy(() => import("./pages/settings/Placeholders"));
const Stats = lazy(() => import("./pages/Stats"));
const Notify = lazy(() => import("./pages/Notify"));
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

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    // Prefetch critical routes for instant navigation
    prefetchRoutes();
  }, []);

  useEffect(() => {
    // Apply saved theme immediately to prevent layout flash
    const savedColor = localStorage.getItem('color-theme') || 'cannabis';
    const savedMode = localStorage.getItem('dark-mode') === 'true';

    const html = document.documentElement;
    const themeClass = savedMode ? `theme-${savedColor}-dark` : `theme-${savedColor}`;
    html.classList.add(themeClass);

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
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <SpeedInsights />
        <BrowserRouter>
          <Routes>
            {/* Special pages without layout */}
            <Route path="/auth" element={<LazyPage component={Auth} />} />

            {/* Pages with layout */}
            <Route path="/" element={<AppLayout><Outlet /></AppLayout>}>
              <Route index element={<LazyPage component={Index} />} />
              <Route path="boards" element={<LazyPage component={BoardsView} />} />
              <Route path="messages" element={<LazyPage component={Messages} />} />
              <Route path="profile/:userId" element={<LazyPage component={Profile} />} />
              <Route path="moderation" element={<LazyPage component={Moderation} />} />
              <Route path="moderation/posts" element={<LazyPage component={ModerationPosts} />} />
              <Route path="moderation/emojis" element={<LazyPage component={EmojiModeration} />} />
              <Route path="moderation/emojis/create" element={<LazyPage component={EmojiCreate} />} />
              <Route path="moderation/emojis/edit" element={<LazyPage component={EmojiEdit} />} />
              <Route path="moderation/emojis/edit/:emojiId" element={<LazyPage component={EmojiEditForm} />} />
              <Route path="settings" element={<LazyPage component={Settings} />} />
              <Route path="settings/custom" element={<LazyPage component={CustomProfile} />} />
              <Route path="settings/placeholders" element={<LazyPage component={Placeholders} />} />
              <Route path="stats" element={<LazyPage component={Stats} />} />
              <Route path="notify" element={<LazyPage component={Notify} />} />
              <Route path="create" element={<LazyPage component={CreateThread} />} />
              <Route path=":slug" element={<LazyPage component={Board} />} />
              <Route path=":slug/thread/:threadId" element={<LazyPage component={Thread} />} />
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<AppLayout><LazyPage component={NotFound} /></AppLayout>} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
