import { create } from "zustand";

/**
 * Global manager for autoplaying "animated" clips (soundless short videos).
 *
 * Playing every visible clip at once melts weak phones, so at most a few play
 * at a time and the ones closest to the viewport center win. A single shared
 * scroll/resize listener recomputes the ranking, so N components cost one
 * listener, not N.
 */
export type AutoplayMode = "always" | "wifi" | "never";

const MAX_CONCURRENT = 3;
const STORAGE_KEY = "gomo6_autoplay_media";

function loadMode(): AutoplayMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "always" || stored === "wifi" || stored === "never") return stored;
  } catch {
    // private mode / no storage
  }
  return "always";
}

type AnimatedVideoState = {
  /** id → element, for every clip currently near the viewport. */
  candidates: Map<string, HTMLElement>;
  /** ids allowed to play right now (nearest first, capped). */
  activeIds: string[];
  autoplayMode: AutoplayMode;
  register: (id: string, element: HTMLElement) => void;
  unregister: (id: string) => void;
  recompute: () => void;
  setAutoplayMode: (mode: AutoplayMode) => void;
};

let listenerBound = false;
let rafId: number | null = null;

export const useAnimatedVideoStore = create<AnimatedVideoState>((set, get) => ({
  candidates: new Map(),
  activeIds: [],
  autoplayMode: loadMode(),

  register: (id, element) => {
    const next = new Map(get().candidates);
    next.set(id, element);
    set({ candidates: next });
    bindScrollListener();
    get().recompute();
  },

  unregister: (id) => {
    if (!get().candidates.has(id)) return;
    const next = new Map(get().candidates);
    next.delete(id);
    set({ candidates: next });
    get().recompute();
  },

  recompute: () => {
    const { candidates, activeIds } = get();
    if (candidates.size === 0) {
      if (activeIds.length) set({ activeIds: [] });
      return;
    }
    const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight || 0;
    const ranked = [...candidates.entries()]
      .map(([id, element]) => {
        const rect = element.getBoundingClientRect();
        const onScreen = rect.bottom > 0 && rect.top < viewportHeight;
        const distance = Math.abs(rect.top + rect.height / 2 - viewportHeight / 2);
        return { id, distance, onScreen };
      })
      .filter((entry) => entry.onScreen)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, MAX_CONCURRENT)
      .map((entry) => entry.id);

    const unchanged =
      ranked.length === activeIds.length && ranked.every((id, index) => id === activeIds[index]);
    if (!unchanged) set({ activeIds: ranked });
  },

  setAutoplayMode: (mode) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
    set({ autoplayMode: mode });
  },
}));

// One shared scroll/resize listener drives the ranking for every registered
// clip, so N components cost one listener instead of N.
function bindScrollListener() {
  if (listenerBound || typeof window === "undefined") return;
  listenerBound = true;
  const schedule = () => {
    if (rafId != null) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      useAnimatedVideoStore.getState().recompute();
    });
  };
  window.addEventListener("scroll", schedule, { passive: true, capture: true });
  window.addEventListener("resize", schedule, { passive: true });
}

/**
 * Whether animated clips may autoplay right now: the user's choice, the
 * browser's data-saver hint and the OS reduced-motion preference all apply.
 */
export function shouldAutoplay(
  mode: AutoplayMode = useAnimatedVideoStore.getState().autoplayMode,
): boolean {
  if (mode === "never") return false;

  if (typeof navigator !== "undefined") {
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    ).connection;
    if (connection?.saveData) return false;
    if (mode === "wifi" && connection?.effectiveType && /2g|3g/.test(connection.effectiveType)) {
      return false;
    }
  }

  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return false;
  }

  return true;
}
