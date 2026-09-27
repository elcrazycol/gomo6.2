import { create } from "zustand";

/**
 * Custom sidebar tabs («вкладки»): a section/subsection the user pinned to the
 * sidebar under their own name, optionally opening instead of the feed on the
 * main page.
 *
 * A client-side appearance preference (like the header behaviour / Mr.
 * рандомность count): persisted in localStorage, no backend.
 */
export interface SidebarTab {
  id: string;
  sectionSlug: string;
  subsectionSlug: string | null;
  label: string;
  /** Open this tab instead of the feed on the main page. At most one. */
  isHome: boolean;
}

const STORAGE_KEY = "gomo6:sidebar-tabs";

const load = (): SidebarTab[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

const save = (tabs: SidebarTab[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // ignore (private mode / quota)
  }
};

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;

type SidebarTabsState = {
  tabs: SidebarTab[];
  addTab: (tab: Omit<SidebarTab, "id">) => void;
  removeTab: (id: string) => void;
  setHome: (id: string | null) => void;
};

export const useSidebarTabsStore = create<SidebarTabsState>((set, get) => ({
  tabs: load(),
  addTab: (tab) => {
    // At most one home tab.
    const base = tab.isHome ? get().tabs.map((t) => ({ ...t, isHome: false })) : get().tabs;
    const next = [
      ...base,
      {
        id: uid(),
        sectionSlug: tab.sectionSlug,
        subsectionSlug: tab.subsectionSlug ?? null,
        label: tab.label,
        isHome: Boolean(tab.isHome),
      },
    ];
    save(next);
    set({ tabs: next });
  },
  removeTab: (id) => {
    const next = get().tabs.filter((t) => t.id !== id);
    save(next);
    set({ tabs: next });
  },
  setHome: (id) => {
    const next = get().tabs.map((t) => ({ ...t, isHome: t.id === id }));
    save(next);
    set({ tabs: next });
  },
}));
