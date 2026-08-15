/**
 * Profile background display variants.
 *
 * The profile owner uploads ONE background image (avatar + background) and
 * picks how it is displayed — for EVERY viewer — in the profile studio
 * (banner/card/page/page_dim, stored as profile_customization.background_variant).
 * There is no per-viewer choice anymore: everyone sees the owner's variant
 * (default: banner).
 */
export type ProfileBackgroundVariant = "banner" | "card" | "page" | "page_dim";

export const PROFILE_BACKGROUND_VARIANTS: Array<{
  id: ProfileBackgroundVariant;
  name: string;
  description: string;
  /** Tiny CSS preview of the variant (used in the studio picker). */
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

/** Normalize an arbitrary value (e.g. from the DB) to a valid variant. */
export const normalizeProfileBackgroundVariant = (v: unknown): ProfileBackgroundVariant => {
  if (typeof v === "string" && PROFILE_BACKGROUND_VARIANTS.some((x) => x.id === v)) {
    return v as ProfileBackgroundVariant;
  }
  return DEFAULT_PROFILE_BACKGROUND_VARIANT;
};
