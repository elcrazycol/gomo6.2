import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { PentagramLoader } from "@/components/PentagramLoader";

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Route guard: redirects to /auth if the user is not authenticated.
 * Shows loading spinner while auth state is being determined.
 * Preserves the original URL as ?redirect= param so the user returns after login.
 */
export const AuthGuard = ({ children }: AuthGuardProps) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <PentagramLoader size="md" />
      </div>
    );
  }

  if (!user) {
    const redirect = location.pathname + location.search;
    return <Navigate to={`/auth?redirect=${encodeURIComponent(redirect)}`} replace />;
  }

  return <>{children}</>;
};
