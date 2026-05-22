import { StrictMode, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import DeveloperApps from "./pages/Apps";
import CreateApp from "./pages/CreateApp";
import AppDetail from "./pages/AppDetail";
import Login from "./pages/Login";
import Callback from "./pages/Callback";
import { getAccessToken, getSavedUser, logout, OAuthUser, checkAuth } from "@/lib/oauth";
import { Button } from "@/components/ui/button";
import { LogOut, BookOpen } from "lucide-react";

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
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}

// Header with user info and logout
function Header() {
  const navigate = useNavigate();
  const [user, setUser] = useState<OAuthUser | null>(null);

  useEffect(() => {
    setUser(getSavedUser());
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <header className="border-b border-border bg-card sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <a
              href="http://localhost:8081"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-sm hover:text-emerald-400 transition-colors"
            >
              gomo6
            </a>
            <span className="font-semibold text-sm text-muted-foreground">
              Dev
            </span>
          </div>
          <nav className="flex items-center gap-1 ml-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/apps")}
              className="text-xs"
            >
              Приложения
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open("http://localhost:3001/oauth", "_blank")}
              className="text-xs gap-1"
            >
              <BookOpen className="w-3 h-3" />
              Документация
            </Button>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {user && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {user.picture ? (
                <img
                  src={user.picture}
                  alt=""
                  className="w-6 h-6 rounded-full ring-1 ring-border"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center ring-1 ring-emerald-500/30">
                  <span className="text-[10px] font-medium text-emerald-400">
                    {(user.preferred_username || user.name || "?")[0].toUpperCase()}
                  </span>
                </div>
              )}
              <span className="hidden sm:inline text-xs">
                {user.preferred_username || user.name || user.email || ""}
              </span>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            <LogOut className="w-3 h-3 mr-1" />
            Выйти
          </Button>
        </div>
      </div>
    </header>
  );
}

// Main layout with header
function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pb-12">
        {children}
      </main>
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
