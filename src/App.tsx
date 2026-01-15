import { useEffect, useState, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { RussianBlock } from "@/components/RussianBlock";
import { LazyPage } from "@/components/LazyPage";

// Lazy load pages for better performance
const Index = lazy(() => import("./pages/Index"));
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
const Notify = lazy(() => import("./pages/Notify"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => {
  const [isRussianBlocked, setIsRussianBlocked] = useState(false);
  const [locationChecked, setLocationChecked] = useState(false);

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

    // Check if user is from Russia
    const checkLocation = async () => {
      try {
        const response = await fetch('https://ipapi.co/json/');
        const data = await response.json();

        if (data.country_code === 'RU') {
          setIsRussianBlocked(true);
        }
      } catch (error) {
        // Fallback: check via IP ranges (simplified Russian IP check)
        try {
          const response = await fetch('https://api.ipify.org?format=json');
          const ipData = await response.json();

          if (ipData.ip) {
            const ip = ipData.ip.split('.').map(Number);
            // Check for Russian IP ranges (simplified)
            if ((ip[0] === 5 || ip[0] === 31 || ip[0] === 37 || ip[0] === 46 ||
                 ip[0] === 62 || (ip[0] === 77 && ip[1] >= 0 && ip[1] <= 255) ||
                 ip[0] === 78 || ip[0] === 79 || ip[0] === 80 || ip[0] === 81 ||
                 ip[0] === 82 || ip[0] === 83 || ip[0] === 84 || ip[0] === 85 ||
                 ip[0] === 86 || ip[0] === 87 || ip[0] === 89 || ip[0] === 90 ||
                 ip[0] === 91 || ip[0] === 92 || ip[0] === 93 || ip[0] === 94 ||
                 ip[0] === 95 || ip[0] === 109 || ip[0] === 128 || ip[0] === 130 ||
                 ip[0] === 141 || ip[0] === 145 || ip[0] === 151 || ip[0] === 158 ||
                 ip[0] === 159 || ip[0] === 160 || ip[0] === 161 || ip[0] === 162 ||
                 ip[0] === 176 || ip[0] === 178 || ip[0] === 185 || ip[0] === 188 ||
                 ip[0] === 193 || ip[0] === 194 || ip[0] === 195 || ip[0] === 212 ||
                 ip[0] === 213 || ip[0] === 217 || ip[0] === 218 || ip[0] === 219 ||
                 ip[0] === 220 || ip[0] === 221) ||
                // Additional Russian ranges
                (ip[0] === 2 && ip[1] >= 60 && ip[1] <= 76) ||
                (ip[0] === 2 && ip[1] >= 92 && ip[1] <= 108)) {
              setIsRussianBlocked(true);
            }
          }
        } catch (fallbackError) {
          console.log('Location check failed, allowing access');
        }
      }
      setLocationChecked(true);
    };

    checkLocation();
  }, []);

  // Show loading while checking location
  if (!locationChecked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Загрузка...</p>
        </div>
      </div>
    );
  }

  // Show Russian block page if user is from Russia
  if (isRussianBlocked) {
    return <RussianBlock />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <SpeedInsights />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LazyPage component={Index} />} />
            <Route path="/auth" element={<LazyPage component={Auth} />} />
            <Route path="/profile/:userId" element={<LazyPage component={Profile} />} />
            <Route path="/moderation" element={<LazyPage component={Moderation} />} />
            <Route path="/moderation/posts" element={<LazyPage component={ModerationPosts} />} />
            <Route path="/moderation/emojis" element={<LazyPage component={EmojiModeration} />} />
            <Route path="/moderation/emojis/create" element={<LazyPage component={EmojiCreate} />} />
            <Route path="/moderation/emojis/edit" element={<LazyPage component={EmojiEdit} />} />
            <Route path="/moderation/emojis/edit/:emojiId" element={<LazyPage component={EmojiEditForm} />} />
            <Route path="/messages" element={<LazyPage component={Messages} />} />
            <Route path="/settings" element={<LazyPage component={Settings} />} />
            <Route path="/settings/custom" element={<LazyPage component={CustomProfile} />} />
            <Route path="/settings/placeholders" element={<LazyPage component={Placeholders} />} />
            <Route path="/notify" element={<LazyPage component={Notify} />} />
            <Route path="/:slug" element={<LazyPage component={Board} />} />
            <Route path="/:slug/thread/:threadId" element={<LazyPage component={Thread} />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<LazyPage component={NotFound} />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
