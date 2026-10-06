import { create } from "zustand";

import { apiClient } from "@/integrations/api/client";

export type FavoriteItemType = "thread" | "wall_post";

const keyOf = (type: string, id: string) => `${type}:${id}`;

/**
 * Per-viewer favorites, held as a set of `"<type>:<id>"` keys.
 *
 * Loaded once per session from `/api/v1/favorites/ids` so every card can render
 * its bookmark state without a request of its own; toggling updates the set
 * optimistically and rolls back if the write fails. The full list lives on the
 * «Избранное» page, which reads the same set to drop a card the moment its
 * bookmark is removed.
 */
type FavoritesState = {
  ids: Set<string>;
  loaded: boolean;
  load: (force?: boolean) => Promise<void>;
  toggle: (type: FavoriteItemType, id: string) => Promise<void>;
  reset: () => void;
};

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  ids: new Set<string>(),
  loaded: false,
  load: async (force = false) => {
    if (get().loaded && !force) return;
    try {
      const resp = await apiClient.request<{ item_type: string; item_id: string }[]>(
        "/api/v1/favorites/ids",
      );
      const ids = new Set<string>((resp.data || []).map((row) => keyOf(row.item_type, row.item_id)));
      set({ ids, loaded: true });
    } catch {
      // Best-effort — cards simply show "not favorited".
    }
  },
  toggle: async (type, id) => {
    const key = keyOf(type, id);
    const had = get().ids.has(key);
    const next = new Set(get().ids);
    if (had) next.delete(key);
    else next.add(key);
    set({ ids: next });

    try {
      if (had) {
        await apiClient.request(`/api/v1/favorites/${type}/${id}`, { method: "DELETE" });
      } else {
        await apiClient.request("/api/v1/favorites", {
          method: "POST",
          body: JSON.stringify({ item_type: type, item_id: id }),
        });
      }
    } catch {
      // Roll back the optimistic change.
      const revert = new Set(get().ids);
      if (had) revert.add(key);
      else revert.delete(key);
      set({ ids: revert });
    }
  },
  reset: () => set({ ids: new Set<string>(), loaded: false }),
}));

/** Subscribe-friendly helper for a single card. */
export const favoriteKey = keyOf;
