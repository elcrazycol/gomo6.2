import { describe, it, expect, beforeEach, vi } from "vitest";

import { useSidebarTabsStore } from "@/stores/sidebarTabsStore";

const requestMock = vi.fn();
vi.mock("@/integrations/api/client", () => ({
  apiClient: { request: (...args: any[]) => requestMock(...args) },
}));

describe("sidebarTabsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSidebarTabsStore.setState({ tabs: [], loaded: false });
  });

  it("loads tabs from the API", async () => {
    requestMock.mockResolvedValue({
      data: [{ id: "t1", section_slug: "games", subsection_slug: "pc", label: "Игры — ПК", is_home: false }],
    });

    await useSidebarTabsStore.getState().load(true);

    const tabs = useSidebarTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].sectionSlug).toBe("games");
    expect(tabs[0].subsectionSlug).toBe("pc");
    expect(tabs[0].isHome).toBe(false);
  });

  it("adds a tab and adopts the returned list", async () => {
    requestMock.mockResolvedValue({
      data: [{ id: "t2", section_slug: "tech", subsection_slug: null, label: "Тех", is_home: true }],
    });

    await useSidebarTabsStore
      .getState()
      .addTab({ sectionSlug: "tech", subsectionSlug: null, label: "Тех", isHome: true });

    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/sidebar_tabs",
      expect.objectContaining({ method: "POST" }),
    );
    expect(useSidebarTabsStore.getState().tabs[0].isHome).toBe(true);
  });

  it("removes a tab", async () => {
    useSidebarTabsStore.setState({
      tabs: [{ id: "t1", sectionSlug: "games", subsectionSlug: null, label: "Игры", isHome: false }],
    });
    requestMock.mockResolvedValue({ data: [] });

    await useSidebarTabsStore.getState().removeTab("t1");

    expect(requestMock).toHaveBeenCalledWith("/api/v1/sidebar_tabs/t1", { method: "DELETE" });
    expect(useSidebarTabsStore.getState().tabs).toHaveLength(0);
  });

  it("migrates legacy localStorage tabs once when the API is empty", async () => {
    localStorage.setItem(
      "gomo6:sidebar-tabs",
      JSON.stringify([{ id: "old", sectionSlug: "games", subsectionSlug: null, label: "Игры", isHome: false }]),
    );
    requestMock
      .mockResolvedValueOnce({ data: [] }) // initial GET
      .mockResolvedValueOnce({ data: {} }) // POST (migrate)
      .mockResolvedValueOnce({
        data: [{ id: "new", section_slug: "games", subsection_slug: null, label: "Игры", is_home: false }],
      }); // re-GET

    await useSidebarTabsStore.getState().load(true);

    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/sidebar_tabs",
      expect.objectContaining({ method: "POST" }),
    );
    expect(localStorage.getItem("gomo6:sidebar-tabs")).toBeNull();
    expect(useSidebarTabsStore.getState().tabs[0].id).toBe("new");
  });
});
