import { create } from "zustand";

/**
 * App-wide thin loading bar, rendered at the bottom edge of the header.
 *
 * A counter rather than a boolean: several views can fetch at once (e.g. the
 * feed stays mounted while a section loads), and the bar must remain visible
 * until the last one settles. Callers `begin()` before a fetch and `end()` in
 * `finally`.
 */
type LoadingBarState = {
  count: number;
  begin: () => void;
  end: () => void;
};

export const useLoadingBarStore = create<LoadingBarState>((set) => ({
  count: 0,
  begin: () => set((state) => ({ count: state.count + 1 })),
  end: () => set((state) => ({ count: Math.max(0, state.count - 1) })),
}));
