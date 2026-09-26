/**
 * Header behaviour — the user picks how the top bar behaves while scrolling in
 * Settings → Appearance, and AppLayout reacts live (no reload).
 *
 * "fixed"     — the header is always on screen (default).
 * "auto-hide" — it slides away on scroll-down and comes back on scroll-up.
 *
 * Note that the header is `position: fixed` either way; the choice only affects
 * whether it auto-hides. Stored in localStorage like the other appearance
 * preferences (theme, publish-button style).
 */

export type HeaderBehavior = "fixed" | "auto-hide";

export const HEADER_BEHAVIOR_KEY = "header-behavior";

export const DEFAULT_HEADER_BEHAVIOR: HeaderBehavior = "fixed";

export const HEADER_BEHAVIORS: { id: HeaderBehavior; label: string; description: string }[] = [
  {
    id: "fixed",
    label: "Фиксированный",
    description: "Всегда на виду — не прячется при прокрутке",
  },
  {
    id: "auto-hide",
    label: "Автоскрытие",
    description: "Уезжает при прокрутке вниз и возвращается при прокрутке вверх",
  },
];

/** Broadcast so AppLayout picks up a change made on the Settings page. */
export const HEADER_BEHAVIOR_EVENT = "gomo6:header-behavior";

export const getHeaderBehavior = (): HeaderBehavior => {
  const saved = localStorage.getItem(HEADER_BEHAVIOR_KEY);
  return HEADER_BEHAVIORS.some((b) => b.id === saved) ? (saved as HeaderBehavior) : DEFAULT_HEADER_BEHAVIOR;
};

export const setHeaderBehavior = (behavior: HeaderBehavior): void => {
  localStorage.setItem(HEADER_BEHAVIOR_KEY, behavior);
  window.dispatchEvent(new CustomEvent(HEADER_BEHAVIOR_EVENT, { detail: { behavior } }));
};
