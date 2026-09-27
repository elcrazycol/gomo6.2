import { create } from "zustand";

import { apiClient } from "@/integrations/api/client";

/**
 * Custom sidebar tabs («вкладки»): a section/subsection the user pinned to the
 * sidebar under their own name, optionally opening instead of the feed.
 *
 * Backed by the API (GET/POST/PUT/DELETE /api/v1/sidebar_tabs) so the tabs sync
 * across devices. Mutations return the full updated list, so the store never
 * needs a follow-up GET.
 */
export interface SidebarTab {
  id: string;
  sectionSlug: string;
  subsectionSlug: string | null;
  label: string;
  /** Open this tab instead of the feed on the main page. At most one. */
  isHome: boolean;
}

interface ApiSidebarTab {
  id: string;
  section_slug: string;
  subsection_slug?: string | null;
  label: string;
  is_home: boolean;
}

const fromApi = (tab: ApiSidebarTab): SidebarTab => ({
  id: tab.id,
  sectionSlug: tab.section_slug,
  subsectionSlug: tab.subsection_slug ?? null,
  label: tab.label,
  isHome: Boolean(tab.is_home),
});

const asTabs = (data: unknown): SidebarTab[] | null => {
  if (!Array.isArray(data)) return null;
  return (data as ApiSidebarTab[]).map(fromApi);
};

/** Old localStorage store (pre-backend); migrated once, then removed. */
const LEGACY_KEY = "gomo6:sidebar-tabs";

const readLegacy = (): SidebarTab[] => {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t.id === "string" && typeof t.sectionSlug === "string")
      .map((t) => ({
        id: String(t.id),
        sectionSlug: String(t.sectionSlug),
        subsectionSlug: t.subsectionSlug ? String(t.subsectionSlug) : null,
        label: typeof t.label === "string" && t.label ? t.label : String(t.sectionSlug),
        isHome: Boolean(t.isHome),
      }));
  } catch {
    return [];
  }
};

const postTab = (tab: Omit<SidebarTab, "id">) =>
  apiClient.request<ApiSidebarTab[]>("/api/v1/sidebar_tabs", {
    method: "POST",
    body: JSON.stringify({
      section_slug: tab.sectionSlug,
      subsection_slug: tab.subsectionSlug,
      label: tab.label,
      is_home: tab.isHome,
    }),
  });

type SidebarTabsState = {
  tabs: SidebarTab[];
  loaded: boolean;
  load: (force?: boolean) => Promise<void>;
  addTab: (tab: Omit<SidebarTab, "id">) => Promise<void>;
  removeTab: (id: string) => Promise<void>;
  setHome: (id: string | null) => Promise<void>;
  reset: () => void;
};

export const useSidebarTabsStore = create<SidebarTabsState>((set, get) => ({
  tabs: [],
  loaded: false,
  load: async (force = false) => {
    if (get().loaded && !force) return;
    try {
      const resp = await apiClient.request<ApiSidebarTab[]>("/api/v1/sidebar_tabs");
      let tabs = asTabs(resp.data);

      // One-time migration from the old localStorage store.
      const legacy = readLegacy();
      if (tabs && tabs.length === 0 && legacy.length > 0) {
        for (const tab of legacy) {
          await postTab(tab).catch(() => {});
        }
        try {
          localStorage.removeItem(LEGACY_KEY);
        } catch {
          // ignore
        }
        const again = await apiClient.request<ApiSidebarTab[]>("/api/v1/sidebar_tabs");
        tabs = asTabs(again.data) ?? tabs;
      }

      set({ tabs: tabs ?? get().tabs, loaded: true });
    } catch {
      // Guest / offline — leave the current tabs as they are.
    }
  },
  addTab: async (tab) => {
    try {
      const resp = await postTab(tab);
      set({ tabs: asTabs(resp.data) ?? get().tabs });
    } catch (error) {
      console.error("Error adding sidebar tab:", error);
    }
  },
  removeTab: async (id) => {
    try {
      const resp = await apiClient.request<ApiSidebarTab[]>(`/api/v1/sidebar_tabs/${id}`, {
        method: "DELETE",
      });
      set({ tabs: asTabs(resp.data) ?? get().tabs });
    } catch (error) {
      console.error("Error removing sidebar tab:", error);
    }
  },
  setHome: async (id) => {
    if (id === null) {
      for (const tab of get().tabs.filter((t) => t.isHome)) {
        await apiClient
          .request(`/api/v1/sidebar_tabs/${tab.id}`, {
            method: "PUT",
            body: JSON.stringify({ is_home: false }),
          })
          .catch(() => {});
      }
      await get().load(true);
      return;
    }
    try {
      const resp = await apiClient.request<ApiSidebarTab[]>(`/api/v1/sidebar_tabs/${id}`, {
        method: "PUT",
        body: JSON.stringify({ is_home: true }),
      });
      set({ tabs: asTabs(resp.data) ?? get().tabs });
    } catch (error) {
      console.error("Error setting home sidebar tab:", error);
    }
  },
  reset: () => set({ tabs: [], loaded: false }),
}));
