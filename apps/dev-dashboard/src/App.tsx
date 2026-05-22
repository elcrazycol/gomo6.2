import { StrictMode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import DeveloperApps from "./pages/Apps";
import CreateApp from "./pages/CreateApp";
import AppDetail from "./pages/AppDetail";
import Login from "./pages/Login";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

const App = () => {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Toaster richColors position="top-right" />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/apps" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/apps" element={<DeveloperApps />} />
            <Route path="/apps/create" element={<CreateApp />} />
            <Route path="/apps/:id" element={<AppDetail />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>
  );
};

export default App;
