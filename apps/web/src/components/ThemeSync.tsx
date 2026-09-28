import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { startAppearanceAutoPush, syncAppearanceWithServer } from "@/theme";

/**
 * Keeps the logged-in user's appearance settings (theme, mode, font, favourite
 * themes) in sync with the server: pull on login, push changes afterwards.
 * Renders nothing.
 */
export const ThemeSync = () => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    const stop = startAppearanceAutoPush();
    void syncAppearanceWithServer().catch(() => undefined);
    return stop;
  }, [userId]);

  return null;
};
