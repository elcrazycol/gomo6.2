/**
 * «Mr. рандомность» — how many random items the sidebar block shows.
 *
 * A client-side appearance preference (like the header behaviour / theme):
 * stored in localStorage and broadcast via an event so the sidebar reacts live
 * without a reload. Defaults to a single item.
 */

export const MR_RANDOM_COUNT_KEY = "mr-random-count";

export const DEFAULT_MR_RANDOM_COUNT = 1;

export const MIN_MR_RANDOM_COUNT = 1;
export const MAX_MR_RANDOM_COUNT = 10;

/** Preset choices offered in Settings. */
export const MR_RANDOM_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6] as const;

export const MR_RANDOM_COUNT_EVENT = "gomo6:mr-random-count";

export const getMrRandomCount = (): number => {
  const raw = Number(localStorage.getItem(MR_RANDOM_COUNT_KEY));
  if (!Number.isFinite(raw) || raw < MIN_MR_RANDOM_COUNT) return DEFAULT_MR_RANDOM_COUNT;
  return Math.min(Math.floor(raw), MAX_MR_RANDOM_COUNT);
};

export const setMrRandomCount = (count: number): void => {
  const clamped = Math.min(Math.max(Math.floor(count), MIN_MR_RANDOM_COUNT), MAX_MR_RANDOM_COUNT);
  localStorage.setItem(MR_RANDOM_COUNT_KEY, String(clamped));
  window.dispatchEvent(new CustomEvent(MR_RANDOM_COUNT_EVENT, { detail: { count: clamped } }));
};
