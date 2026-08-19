import { create } from "zustand";
import { api } from "@/integrations/api/compat";
import {
  applyTranslationOverrides,
  getActiveLanguage,
  getStoredLanguage,
  loadCommunityTranslations,
  setLanguage as setI18nLanguage,
} from "@/i18n";
import { DEFAULT_LANGUAGE, normalizeLanguage } from "@/i18n/languages";

interface LanguageState {
  language: string;
  /** True once the boot-time language resolution has finished. */
  ready: boolean;
  initialize: () => Promise<void>;
  changeLanguage: (code: string, userId?: string | null) => Promise<void>;
}

// Every async initializer/switch gets a generation. A request from an older
// generation is never allowed to overwrite a newer user choice.
let languageGeneration = 0;

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: getStoredLanguage(),
  ready: false,

  initialize: async () => {
    const generation = ++languageGeneration;
    const stored = getStoredLanguage();
    try {
      // Signed-in users keep their language in profile_customization.language;
      // guests use the locally stored value.
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
        if (profileLang) resolved = normalizeLanguage(profileLang);
      }

      if (generation !== languageGeneration) return;

      // Prepare the complete catalog before changing i18next. This avoids a
      // render with one language's dates and another language's UI strings.
      await loadCommunityTranslations(resolved, {
        isCurrent: () => generation === languageGeneration,
      });
      if (generation !== languageGeneration) return;

      if (resolved !== getActiveLanguage()) {
        await setI18nLanguage(resolved);
      }
      if (generation !== languageGeneration) return;
      set({ language: resolved, ready: true });
    } catch {
      // Boot must never fail because of a language fetch. Do not overwrite a
      // newer manual selection if this request became stale meanwhile.
      if (generation === languageGeneration) {
        set({ language: stored, ready: true });
      }
    }
  },

  changeLanguage: async (code: string, userId?: string | null) => {
    const generation = ++languageGeneration;
    const language = normalizeLanguage(code);

    // Load the complete community catalog first. If it fails, setLanguage still
    // activates the language and i18next falls back to Russian for missing keys.
    await loadCommunityTranslations(language, {
      isCurrent: () => generation === languageGeneration,
    });
    if (generation !== languageGeneration) return;

    await setI18nLanguage(language);
    if (generation !== languageGeneration) return;
    set({ language, ready: true });

    // Persistence is best-effort: a database error must never roll the visible
    // language back or become an unhandled promise rejection.
    if (userId) {
      try {
        await api.from("profile_customization").upsert({ user_id: userId, language });
      } catch {
        // localStorage and the active runtime language remain valid.
      }
    }
  },
}));

/** Re-export for convenient imports in components. */
export { DEFAULT_LANGUAGE };
export { applyTranslationOverrides };
