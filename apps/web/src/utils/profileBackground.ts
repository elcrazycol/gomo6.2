/**
 * Profile background display variants.
 *
 * The profile owner uploads ONE background image (avatar + background). Every
 * viewer picks how they want backgrounds rendered (Settings → Внешний вид →
 * «Отображение фонов») — like the theme, this is a per-viewer preference kept
 * in localStorage, so each person sees the site the way they like.
 */
export type ProfileBackgroundVariant = "banner" | "card" | "page" | "page_dim";

export const PROFILE_BACKGROUND_VARIANTS: Array<{
  id: ProfileBackgroundVariant;
  name: string;
  description: string;
  /** Tiny CSS preview of the variant (used in the settings picker). */
  preview: string;
}> = [
  {
    id: "banner",
    name: "Баннер",
    description: "Фон-полоса только в шапке профиля, аватар наезжает на неё",
    preview: "linear-gradient(135deg, #7dd3fc 0%, #2dd4bf 60%, #a3e635 100%)",
  },
  {
    id: "card",
    name: "Карточка",
    description: "Фон за всей карточкой профиля (шапка + статистика)",
    preview: "linear-gradient(135deg, #a78bfa 0%, #f472b6 60%, #fb923c 100%)",
  },
  {
    id: "page",
    name: "Вся страница",
    description: "Фон за всей страницей профиля",
    preview: "linear-gradient(135deg, #34d399 0%, #60a5fa 50%, #a78bfa 100%)",
  },
  {
    id: "page_dim",
    name: "Страница с затемнением",
    description: "Фон на всю страницу + лёгкое затемнение, чтобы текст читался",
    preview: "linear-gradient(135deg, #0f172a 0%, #334155 50%, #475569 100%)",
  },
];

export const DEFAULT_PROFILE_BACKGROUND_VARIANT: ProfileBackgroundVariant = "banner";

const VARIANT_STORAGE_KEY = "profile-background-variant";

export const getProfileBackgroundVariant = (): ProfileBackgroundVariant => {
  try {
    const stored = localStorage.getItem(VARIANT_STORAGE_KEY);
    if (stored && PROFILE_BACKGROUND_VARIANTS.some((v) => v.id === stored)) {
      return stored as ProfileBackgroundVariant;
    }
  } catch {
    // localStorage unavailable — fall through to the default.
  }
  return DEFAULT_PROFILE_BACKGROUND_VARIANT;
};

export const setProfileBackgroundVariant = (variant: ProfileBackgroundVariant): void => {
  try {
    localStorage.setItem(VARIANT_STORAGE_KEY, variant);
  } catch {
    // ignore — the preference simply won't persist
  }
  // Open profile pages re-read the variant on this event.
  window.dispatchEvent(new CustomEvent("profile-background:variant-change"));
};
