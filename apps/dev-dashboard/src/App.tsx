import { StrictMode, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import DeveloperApps from "./pages/Apps";
import CreateApp from "./pages/CreateApp";
import AppDetail from "./pages/AppDetail";
import Login from "./pages/Login";
import Callback from "./pages/Callback";
import { getSavedUser, logout, OAuthUser, checkAuth } from "@/lib/oauth";
import { Button } from "@/components/ui/button";
import { LogOut, BookOpen, Github } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

// Auth guard component
function AuthGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAuth().then((authed) => {
      if (!authed) {
        navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`, { replace: true });
      } else {
        setChecking(false);
      }
    });
  }, [navigate, location.pathname]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Проверка авторизации...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// Header with user info and logout — matching main site style
function Header() {
  const navigate = useNavigate();
  const [user, setUser] = useState<OAuthUser | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setUser(getSavedUser());

    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <header
      className={`sticky top-0 z-50 transition-shadow duration-200 ${
        scrolled ? "shadow-lg shadow-black/5" : "shadow-none"
      }`}
    >
      <div className="bg-board-header text-board-header-foreground">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Left: Logo + Nav */}
            <div className="flex items-center gap-6">                <a
                  href="/"
                  className="flex items-center gap-2 font-bold text-lg tracking-tight hover:text-emerald-300 transition-colors"
                >
                  <span>gomo6</span>
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-white/10 text-emerald-200">
                    Dev
                  </span>
                </a>

              <nav className="hidden sm:flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(`//docs.${window.location.host}/oauth`, "_blank")}
                  className="text-xs gap-1.5 text-board-header-foreground/90 hover:bg-white/15 hover:text-white transition-colors"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  Документация
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open("https://github.com/scramble22/gomo6", "_blank")}
                  className="text-xs gap-1.5 text-board-header-foreground/90 hover:bg-white/15 hover:text-white transition-colors"
                >
                  <Github className="w-3.5 h-3.5" />
                  GitHub
                </Button>
              </nav>
            </div>

            {/* Right: User info */}
            <div className="flex items-center gap-2">
              {user && (
                <div className="flex items-center gap-2.5">
                  <div className="hidden sm:flex items-center gap-2 text-sm">
                    {user.picture ? (
                      <img
                        src={user.picture}
                        alt=""
                        className="w-7 h-7 rounded-full ring-2 ring-white/20"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-emerald-500/30 flex items-center justify-center ring-2 ring-white/20">
                        <span className="text-xs font-semibold text-emerald-200">
                          {(user.preferred_username || user.name || "?")[0].toUpperCase()}
                        </span>
                      </div>
                    )}
                    <span className="text-xs font-medium text-board-header-foreground/90 max-w-[120px] truncate">
                      {user.preferred_username || user.name || user.email || ""}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLogout}
                    className="text-xs text-board-header-foreground/70 hover:text-white hover:bg-white/10"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}

              {/* Mobile nav trigger */}
              <div className="sm:hidden flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(`//docs.${window.location.host}/oauth`, "_blank")}
                  className="text-xs px-2 text-board-header-foreground/90 hover:bg-white/15 hover:text-white transition-colors"
                >
                  <BookOpen className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open("https://github.com/scramble22/gomo6", "_blank")}
                  className="text-xs px-2 text-board-header-foreground/90 hover:bg-white/15 hover:text-white transition-colors"
                >
                  <Github className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Subtle bottom border */}
      <div className="h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />
    </header>
  );
}

// Main layout with header
function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 pb-12 pt-6 sm:pt-8">
        {children}
      </main>
      <footer className="border-t border-border bg-card mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-center gap-4">
            <p className="text-xs text-muted-foreground">
              © 2026 gomo6 Dev Portal
            </p>
            <span className="text-muted-foreground/30">·</span>
            <a
              href={`//docs.${window.location.host}/oauth`}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              OAuth API Docs
            </a>
            <span className="text-muted-foreground/30">·</span>
            <a
              href="/"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              gomo6
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

const App = () => {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Toaster richColors position="top-right" />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/callback" element={<Callback />} />
            <Route
              path="/apps"
              element={
                <AuthGuard>
                  <AppLayout>
                    <DeveloperApps />
                  </AppLayout>
                </AuthGuard>
              }
            />
            <Route
              path="/apps/create"
              element={
                <AuthGuard>
                  <AppLayout>
                    <CreateApp />
                  </AppLayout>
                </AuthGuard>
              }
            />
            <Route
              path="/apps/:id"
              element={
                <AuthGuard>
                  <AppLayout>
                    <AppDetail />
                  </AppLayout>
                </AuthGuard>
              }
            />
            <Route path="/" element={<Navigate to="/apps" replace />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>
  );
};

export default App;
