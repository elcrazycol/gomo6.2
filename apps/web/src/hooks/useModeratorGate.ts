import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import type { User } from "@/integrations/api/client";
import { getCurrentUserMeta } from "@/utils/currentUserMeta";
import { toast } from "sonner";

/**
 * Shared moderator gate for admin pages (/moderation/*, /moderation/emojis/*).
 *
 * Every admin page used to run the same uncached 4-request sequence on mount:
 *   getUser → user_roles → profiles → user_achievements
 * Navigation between admin pages fired all 4 again. This hook collapses the
 * last 3 into getCurrentUserMeta(), which batches them into a single call and
 * caches the result for 5 minutes (invalidated on profile-cache:invalidate).
 *
 * Returns the auth user plus cached meta; redirects unauthenticated users to
 * /auth and non-moderators to "/" with a toast.
 */
export function useModeratorGate() {
  const navigate = useNavigate();
  // Keep the full user object (mobile menu / headers expect the complete
  // OpenAPI User shape); only `.id` is actually consumed by the gate.
  const [user, setUser] = useState<User | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  // True while mounted. Guards against React StrictMode double-fire (dev) and
  // late async resolution after unmount — only the first check applies state
  // and navigation.
  const mountedRef = useRef(true);

  const checkAuth = useCallback(async () => {
    const { data: { user } } = await api.auth.getUser();

    if (!mountedRef.current) return;

    if (!user) {
      navigate("/auth");
      return;
    }

    setUser(user);

    const meta = await getCurrentUserMeta(user.id);
    if (!mountedRef.current) return;

    const isMod = meta.roles.some((r) => r === "moderator" || r === "admin");

    if (!isMod) {
      toast.error("У вас нет доступа к этой странице");
      navigate("/");
      return;
    }

    setIsModerator(true);
    setCurrentUserUsername(meta.username);
    setCurrentUserColor(meta.color);
  }, [navigate]);

  useEffect(() => {
    mountedRef.current = true;
    checkAuth();
    return () => {
      mountedRef.current = false;
    };
  }, [checkAuth]);

  return { user, isModerator, currentUserUsername, currentUserColor };
}
