import { create } from "zustand";
import { api } from "@/integrations/api/compat";
import {
  applyTranslationOverrides,
  getActiveLanguage,
  getStoredLanguage,
  loadCommunityTranslations,
  setLanguage as setI18nLanguage,
} from "@/i18n";
import { DEFAULT_LANGUAGE } from "@/i18n/languages";

interface LanguageState {
  language: string;
  /** True once the boot-time language resolution has finished. */
  ready: boolean;
  initialize: () => Promise<void>;
  changeLanguage: (code: string, userId?: string | null) => Promise<void>;
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: getStoredLanguage(),
  ready: false,

  initialize: async () => {
    const stored = getStoredLanguage();
    try {
      // Signed-in users keep their language in profile_customization.language;
      // guests use the locally stored value. The profile row is fetched through
      // the generic REST layer, which is safe for guests (returns null).
      const { data: { user } } = await api.auth.getUser();
      const userId = user?.id;
      let resolved = stored;
      if (userId) {
        const { data } = await api
          .from("profile_customization")
          .select("language")
          .eq("user_id", userId)
          .maybeSingle();
        const profileLang = (data as { language?: string | null } | null)?.language;
        if (profileLang) resolved = profileLang;
      }
      if (resolved !== getActiveLanguage()) {
        await setI18nLanguage(resolved);
      }
      await loadCommunityTranslations(resolved);
      set({ language: resolved, ready: true });
    } catch {
      // Boot must never fail because of a language fetch — fall back to stored.
      set({ language: stored, ready: true });
    }
  },

  changeLanguage: async (code: string, userId?: string | null) => {
    if (code === get().language) return;
    await setI18nLanguage(code);
    await loadCommunityTranslations(code);
    set({ language: code });

    // Persist server-side when signed in; localStorage is already handled by
    // setI18nLanguage so guests keep their choice across reloads.
    if (userId) {
      try {
        await api.from("profile_customization").upsert({ user_id: userId, language: code });
      } catch {
        // localStorage still holds the choice for this session
      }
    }
  },
}));

/** Re-export for convenient imports in components. */
export { DEFAULT_LANGUAGE };
export { applyTranslationOverrides };
