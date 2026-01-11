import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Board from "./pages/Board";
import Thread from "./pages/Thread";
import Profile from "./pages/Profile";
import Moderation from "./pages/Moderation";
import Messages from "./pages/Messages";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    // Apply saved theme on app load
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
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/profile/:userId" element={<Profile />} />
            <Route path="/moderation" element={<Moderation />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/:slug" element={<Board />} />
            <Route path="/:slug/thread/:threadId" element={<Thread />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
