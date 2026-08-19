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
let languagePersistence: Promise<void> = Promise.resolve();
let initializationStarted = false;
let initializationPromise: Promise<void> | null = null;

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: getStoredLanguage(),
  ready: false,

  initialize: () => {
    // React StrictMode runs mount effects twice in development. Keep one boot
    // operation so the second invocation cannot start a competing profile
    // request and briefly re-activate an older language.
    if (initializationStarted) return initializationPromise ?? Promise.resolve();
    initializationStarted = true;
    const generation = ++languageGeneration;
    const stored = getStoredLanguage();
    initializationPromise = (async () => {
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

      // The catalog is already ready before this point. Avoid emitting a
      // second languageChanged event when the stored/profile language is
      // already active; date-fns consumers must not observe a fake transition.
      if (getActiveLanguage() !== resolved) {
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
    })();
    return initializationPromise;
  },

  changeLanguage: async (code: string, userId?: string | null) => {
    // A manual choice is authoritative even if boot has not finished yet.
    initializationStarted = true;
    const generation = ++languageGeneration;
    const language = normalizeLanguage(code);

    // Load the complete community catalog first. If it fails, setLanguage still
    // activates the language and i18next falls back to Russian for missing keys.
    await loadCommunityTranslations(language, {
      isCurrent: () => generation === languageGeneration,
    });
    if (generation !== languageGeneration) return;

    // Always emit the i18next event after the catalog is ready. This is also
    // required when the user selects the language that is already active: a
    // fresh vote/proposal may have rebuilt its resource bundle.
    await setI18nLanguage(language);
    if (generation !== languageGeneration) return;
    set({ language, ready: true });

    // Serialize persistence writes. Without this queue, a quick uk → en
    // switch can finish its requests in reverse order and leave the profile
    // storing the older language even though the UI is on the newer one.
    if (userId) {
      const persist = languagePersistence.then(async () => {
        if (generation !== languageGeneration) return;
        await api.from("profile_customization").upsert({ user_id: userId, language });
      });
      languagePersistence = persist.catch(() => undefined);
      await persist.catch(() => undefined);
    }
  },
}));

/** Re-export for convenient imports in components. */
export { DEFAULT_LANGUAGE };
export { applyTranslationOverrides };
