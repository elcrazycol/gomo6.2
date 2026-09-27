import { describe, it, expect, beforeEach } from "vitest";

import { useSidebarTabsStore } from "@/stores/sidebarTabsStore";

describe("sidebarTabsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useSidebarTabsStore.setState({ tabs: [] });
  });

  it("adds a tab and persists it", () => {
    useSidebarTabsStore.getState().addTab({
      sectionSlug: "games",
      subsectionSlug: "pc",
      label: "Игры — ПК",
      isHome: false,
    });

    const tabs = useSidebarTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].label).toBe("Игры — ПК");
    expect(tabs[0].subsectionSlug).toBe("pc");
    expect(tabs[0].id).toBeTruthy();

    expect(JSON.parse(localStorage.getItem("gomo6:sidebar-tabs") || "[]")).toHaveLength(1);
  });

  it("keeps at most one home tab", () => {
    const store = useSidebarTabsStore.getState();
    store.addTab({ sectionSlug: "games", subsectionSlug: null, label: "Игры", isHome: true });
    store.addTab({ sectionSlug: "tech", subsectionSlug: null, label: "Тех", isHome: true });

    const tabs = useSidebarTabsStore.getState().tabs;
    expect(tabs.filter((t) => t.isHome)).toHaveLength(1);
    expect(tabs.find((t) => t.isHome)?.sectionSlug).toBe("tech");
  });

  it("removes a tab", () => {
    const store = useSidebarTabsStore.getState();
    store.addTab({ sectionSlug: "games", subsectionSlug: null, label: "Игры", isHome: false });
    const id = useSidebarTabsStore.getState().tabs[0].id;

    useSidebarTabsStore.getState().removeTab(id);
    expect(useSidebarTabsStore.getState().tabs).toHaveLength(0);
  });
});
