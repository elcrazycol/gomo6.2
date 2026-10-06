import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  applyServerAppearance,
  fetchServerAppearance,
  readLocalAppearance,
  syncAppearanceWithServer,
  type ServerAppearance,
} from "./sync";
import { getFavorites, getTimeAuto } from "./preferences";
import { getStoredPrefs } from "./apply";

const jsonResponse = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) });

describe("appearance sync", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the local appearance in server shape", () => {
    localStorage.setItem("color-theme", "slate");
    localStorage.setItem("theme-mode", "dark");
    const state = readLocalAppearance();
    expect(state.theme_id).toBe("slate");
    expect(state.theme_mode).toBe("dark");
    expect(Array.isArray(state.favorite_theme_ids)).toBe(true);
  });

  it("applies server appearance locally", () => {
    const server: ServerAppearance = {
      theme_id: "paper",
      theme_mode: "light",
      time_auto: true,
      custom_font: "",
      favorite_theme_ids: ["slate", "ash", "nonsense"],
    };
    applyServerAppearance(server);
    expect(getStoredPrefs().theme).toBe("paper");
    expect(getStoredPrefs().mode).toBe("light");
    expect(getTimeAuto()).toBe(true);
    // Unknown ids are dropped by the favourites sanitizer.
    expect(getFavorites()).toEqual(["slate", "ash"]);
  });

  it("returns null when the server has no row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: null }) })));
    expect(await fetchServerAppearance()).toBeNull();
  });

  it("pushes local state when the server is empty (migration)", async () => {
    localStorage.setItem("color-theme", "mint");
    localStorage.setItem("theme-mode", "dark");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method !== "PUT") return jsonResponse(null);
      return jsonResponse(null);
    });
    vi.stubGlobal("fetch", fetchMock);

    await syncAppearanceWithServer();

    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PUT");
    expect(putCall, "PUT was sent").toBeTruthy();
    const body = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(body.theme_id).toBe("mint");
  });

  it("pulls server state when a row exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({
        theme_id: "slate",
        theme_mode: "dark",
        time_auto: false,
        custom_font: "",
        favorite_theme_ids: ["ash"],
      })),
    );

    await syncAppearanceWithServer();

    expect(getStoredPrefs().theme).toBe("slate");
    expect(getFavorites()).toEqual(["ash"]);
  });
});
