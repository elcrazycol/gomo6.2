import { StrictMode, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import Dashboard from "./pages/Dashboard";
import DeveloperApps from "./pages/Apps";
import CreateApp from "./pages/CreateApp";
import AppDetail from "./pages/AppDetail";
import GiftAdmin from "./pages/Gifts";
import Login from "./pages/Login";
import Callback from "./pages/Callback";
import { checkAuth } from "@/lib/oauth";
import { Sidebar } from "@/components/Sidebar";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

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

function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem("dev-sidebar-collapsed") === "true";
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("dev-sidebar-collapsed", String(next));
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <main
        className={`pt-4 pb-12 transition-all duration-200 ${
          sidebarCollapsed ? "lg:pl-[68px]" : "lg:pl-60"
        }`}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 lg:pt-8">
          {children}
        </div>
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
              path="/"
              element={
                <AuthGuard>
                  <AppLayout>
                    <Dashboard />
                  </AppLayout>
                </AuthGuard>
              }
            />
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
            <Route
              path="/gifts"
              element={
                <AuthGuard>
                  <AppLayout>
                    <GiftAdmin />
                  </AppLayout>
                </AuthGuard>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>
  );
};

export default App;
