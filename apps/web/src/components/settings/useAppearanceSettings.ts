import { useCallback, useEffect, useState } from "react";
import { api } from "@/integrations/api/compat";
import { toast } from "sonner";
import {
  DEFAULT_MODE_PREF,
  DEFAULT_THEME,
  THEMES,
  applyTheme,
  getStoredPrefs,
  getTheme,
  getTimeAuto,
  resolveMode,
  setStoredPrefs,
  setTimeAuto as persistTimeAuto,
  syncSharedAppearanceCookies,
  watchSystemMode,
  type ThemeModePref,
} from "@/theme";
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
import { getProfileViewMode, setProfileViewMode as persistProfileViewMode, type ProfileViewMode } from "@/lib/profileViewMode";
import { applyCustomFont, getStoredCustomFont, storeCustomFont } from "@/lib/customFont";

/**
 * All appearance preferences in one place. Every one of them is a client-side
 * setting (localStorage + broadcast) that applies instantly — which is why
 * Settings → Внешний вид has no "Save" button. Theme/mode are stored via the
 * theme system's own preference layer (src/theme/apply.ts).
 */

export const useAppearanceSettings = (userId?: string | null) => {
  const [prefs, setPrefs] = useState(() => getStoredPrefs());
  const [timeAuto, setTimeAutoState] = useState<boolean>(() => getTimeAuto());
  const [customFont, setCustomFont] = useState(() => getStoredCustomFont());
  const [publishStyle, setPublishStyleState] = useState<PublishButtonStyle>(getPublishButtonStyle);
  const [headerBehavior, setHeaderBehaviorState] = useState<HeaderBehavior>(getHeaderBehavior);
  const [transitionStyle, setTransitionStyleState] = useState<TransitionStyle>(getTransitionStyle);
  const [mrRandomCount, setMrRandomCountState] = useState<number>(getMrRandomCount);
  const [profileViewMode, setProfileViewModeState] = useState<ProfileViewMode>(getProfileViewMode);

  const autoplayMode = useAnimatedVideoStore((state) => state.autoplayMode);
  const setAutoplayMode = useAnimatedVideoStore((state) => state.setAutoplayMode);
  const language = useLanguageStore((state) => state.language);
  const changeLanguage = useLanguageStore((state) => state.changeLanguage);

  const { theme: colorTheme, mode: modePref } = prefs;
  const isDarkMode = resolveMode(getTheme(colorTheme), modePref, timeAuto) === "dark";

  // Apply on every preference change; the pre-boot script already painted the
  // first frame, this only handles in-app changes.
  useEffect(() => {
    applyTheme(colorTheme, modePref);
  }, [colorTheme, modePref, timeAuto]);

  // Re-resolve when the OS scheme flips while the preference is "system".
  useEffect(() => watchSystemMode(() => applyTheme(colorTheme, modePref)), [colorTheme, modePref, timeAuto]);

  // Restore the saved font on mount.
  useEffect(() => {
    const saved = getStoredCustomFont();
    if (saved) applyCustomFont(saved);
  }, []);

  const setColorTheme = useCallback((next: string) => {
    const updated = setStoredPrefs({ theme: next });
    setPrefs(updated);
    applyTheme(updated.theme, updated.mode);
  }, []);

  const setModePref = useCallback((next: ThemeModePref) => {
    const updated = setStoredPrefs({ mode: next });
    setPrefs(updated);
    applyTheme(updated.theme, updated.mode);
  }, []);

  const setTimeAuto = useCallback((next: boolean) => {
    persistTimeAuto(next);
    setTimeAutoState(next);
    applyTheme(colorTheme, modePref);
  }, [colorTheme, modePref]);

  const randomTheme = useCallback(() => {
    const pool = THEMES.filter((theme) => theme.id !== colorTheme);
    if (pool.length === 0) return;
    setColorTheme(pool[Math.floor(Math.random() * pool.length)].id);
  }, [colorTheme, setColorTheme]);

  const setFont = useCallback((fontName: string) => {
    setCustomFont(fontName);
    storeCustomFont(fontName);
    if (fontName.trim()) {
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

  const setProfileViewMode = useCallback((next: ProfileViewMode) => {
    setProfileViewModeState(next);
    persistProfileViewMode(next);
  }, []);

  const setLanguage = useCallback((code: string) => {
    void changeLanguage(code, userId).catch((error) => {
      console.error("Failed to change language", error);
    });
  }, [changeLanguage, userId]);

  const resetAppearance = useCallback(() => {
    setColorTheme(DEFAULT_THEME);
    setModePref(DEFAULT_MODE_PREF);
    setTimeAuto(false);
    setFont("");
    setPublishStyle("gradient-pill");
    setHeaderBehavior("fixed");
    setTransitionStyle("fade");
    setMrRandomCount(1);
    setProfileViewMode("social");
    setAutoplayMode("always");
    toast.success("Внешний вид сброшен к значениям по умолчанию");
  }, [setColorTheme, setModePref, setTimeAuto, setFont, setPublishStyle, setHeaderBehavior, setTransitionStyle, setMrRandomCount, setProfileViewMode, setAutoplayMode]);

  return {
    colorTheme,
    modePref,
    timeAuto,
    isDarkMode,
    customFont,
    publishStyle,
    headerBehavior,
    transitionStyle,
    mrRandomCount,
    profileViewMode,
    autoplayMode,
    language,
    setColorTheme,
    setModePref,
    setTimeAuto,
    randomTheme,
    setFont,
    setPublishStyle,
    setHeaderBehavior,
    setTransitionStyle,
    setMrRandomCount,
    setProfileViewMode,
    setAutoplayMode,
    setLanguage,
    resetAppearance,
  };
};

export type AppearanceSettings = ReturnType<typeof useAppearanceSettings>;
