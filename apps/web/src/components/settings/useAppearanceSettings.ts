import { useCallback, useEffect, useState } from "react";
import { api } from "@/integrations/api/compat";
import { toast } from "sonner";
import {
  DEFAULT_DARK_MODE,
  DEFAULT_THEME,
  applyTheme,
  getStoredTheme,
  syncSharedAppearanceCookies,
  type ColorTheme,
} from "@/utils/theme";
import { useAnimatedVideoStore } from "@/stores/animatedVideoStore";
import { useLanguageStore } from "@/stores/languageStore";
import { getHeaderBehavior, setHeaderBehavior as persistHeaderBehavior, type HeaderBehavior } from "@/lib/headerBehavior";
import {
  getPublishButtonStyle,
  setPublishButtonStyle as persistPublishButtonStyle,
  type PublishButtonStyle,
} from "@/lib/publishButtonStyle";
import { getTransitionStyle, setTransitionStyle as persistTransitionStyle, type TransitionStyle } from "@/lib/viewTransitions";
import { getMrRandomCount, setMrRandomCount as persistMrRandomCount } from "@/lib/mrRandom";

/**
 * All appearance preferences in one place. Every one of them is a client-side
 * setting (localStorage + a broadcast event) that applies instantly — which is
 * why Settings → Внешний вид has no "Save" button.
 */

const removeGoogleFontLink = () => {
  document.querySelectorAll("link[data-google-font]").forEach((link) => link.remove());
};

const applyGoogleFont = (fontName: string) => {
  removeGoogleFontLink();
  if (!fontName.trim()) {
    document.documentElement.style.removeProperty("--font-family");
    document.body.style.fontFamily = "";
    return;
  }
  const link = document.createElement("link");
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;500;600;700&display=swap`;
  link.rel = "stylesheet";
  link.setAttribute("data-google-font", "true");
  document.head.appendChild(link);

  const fontFamily = `"${fontName}", system-ui, -apple-system, sans-serif`;
  document.documentElement.style.setProperty("--font-family", fontFamily);
  document.body.style.fontFamily = fontFamily;
};

export const useAppearanceSettings = (userId?: string | null) => {
  const [theme, setThemeState] = useState(() => getStoredTheme());
  const [customFont, setCustomFont] = useState(() => {
    try {
      return localStorage.getItem("custom_font") || "";
    } catch {
      return "";
    }
  });
  const [publishStyle, setPublishStyleState] = useState<PublishButtonStyle>(getPublishButtonStyle);
  const [headerBehavior, setHeaderBehaviorState] = useState<HeaderBehavior>(getHeaderBehavior);
  const [transitionStyle, setTransitionStyleState] = useState<TransitionStyle>(getTransitionStyle);
  const [mrRandomCount, setMrRandomCountState] = useState<number>(getMrRandomCount);

  const autoplayMode = useAnimatedVideoStore((state) => state.autoplayMode);
  const setAutoplayMode = useAnimatedVideoStore((state) => state.setAutoplayMode);
  const language = useLanguageStore((state) => state.language);
  const changeLanguage = useLanguageStore((state) => state.changeLanguage);

  const { colorTheme, isDarkMode } = theme;

  // Apply the theme on mount / on every change (also fixes a stale <html> class
  // when the page is opened directly by URL).
  useEffect(() => {
    applyTheme(colorTheme, isDarkMode);
  }, [colorTheme, isDarkMode]);

  // Restore the saved font on mount.
  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem("custom_font") || "";
      } catch {
        return "";
      }
    })();
    if (saved) applyGoogleFont(saved);
  }, []);

  const setColorTheme = useCallback((next: ColorTheme) => {
    setThemeState((prev) => ({ ...prev, colorTheme: next }));
    localStorage.setItem("color-theme", next);
    applyTheme(next, isDarkMode);
  }, [isDarkMode]);

  const setDarkMode = useCallback((next: boolean) => {
    setThemeState((prev) => ({ ...prev, isDarkMode: next }));
    localStorage.setItem("dark-mode", String(next));
    applyTheme(colorTheme, next);
  }, [colorTheme]);

  const setFont = useCallback((fontName: string) => {
    setCustomFont(fontName);
    applyGoogleFont(fontName);
    if (fontName.trim()) {
      localStorage.setItem("custom_font", fontName);
      syncSharedAppearanceCookies();
      if (userId) {
        void api.auth.getSession().then(({ data }) => {
          const token = data.session?.access_token;
          void fetch("/api/v1/user_settings_changes", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ user_id: userId, setting_name: "custom_font" }),
          }).catch(() => undefined);
        });
      }
    } else {
      localStorage.removeItem("custom_font");
      syncSharedAppearanceCookies();
    }
  }, [userId]);

  const setPublishStyle = useCallback((next: PublishButtonStyle) => {
    setPublishStyleState(next);
    persistPublishButtonStyle(next);
  }, []);

  const setHeaderBehavior = useCallback((next: HeaderBehavior) => {
    setHeaderBehaviorState(next);
    persistHeaderBehavior(next);
  }, []);

  const setTransitionStyle = useCallback((next: TransitionStyle) => {
    setTransitionStyleState(next);
    persistTransitionStyle(next);
  }, []);

  const setMrRandomCount = useCallback((next: number) => {
    setMrRandomCountState(next);
    persistMrRandomCount(next);
  }, []);

  const setLanguage = useCallback((code: string) => {
    void changeLanguage(code, userId).catch((error) => {
      console.error("Failed to change language", error);
    });
  }, [changeLanguage, userId]);

  const resetAppearance = useCallback(() => {
    setColorTheme(DEFAULT_THEME);
    setDarkMode(DEFAULT_DARK_MODE);
    setFont("");
    setPublishStyle("gradient-pill");
    setHeaderBehavior("fixed");
    setTransitionStyle("fade");
    setMrRandomCount(1);
    setAutoplayMode("always");
    toast.success("Внешний вид сброшен к значениям по умолчанию");
  }, [setColorTheme, setDarkMode, setFont, setPublishStyle, setHeaderBehavior, setTransitionStyle, setMrRandomCount, setAutoplayMode]);

  return {
    colorTheme,
    isDarkMode,
    customFont,
    publishStyle,
    headerBehavior,
    transitionStyle,
    mrRandomCount,
    autoplayMode,
    language,
    setColorTheme,
    setDarkMode,
    setFont,
    setPublishStyle,
    setHeaderBehavior,
    setTransitionStyle,
    setMrRandomCount,
    setAutoplayMode,
    setLanguage,
    resetAppearance,
  };
};

export type AppearanceSettings = ReturnType<typeof useAppearanceSettings>;
