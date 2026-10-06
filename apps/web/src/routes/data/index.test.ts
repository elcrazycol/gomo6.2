import { describe, it, expect, vi } from "vitest";
import type { Location } from "react-router-dom";

import { matchedRouteData, preloadRoute } from "@/lib/routeData";
// Importing the barrel registers every route-data preloader (App does this).
import "./index";

const ids = (pathname: string) => matchedRouteData(pathname).map((entry) => entry.id);

describe("route data registration", () => {
  it("registers preloaders for the main content routes", () => {
    expect(ids("/profile/42")).toContain("profile");
    expect(ids("/g/test")).toContain("board");
    expect(ids("/g/test/c/general")).toContain("board");
    expect(ids("/thread/7")).toContain("thread");
    expect(ids("/g/test/thread/7")).toContain("thread");
    expect(ids("/g/test/c/general/thread/7")).toContain("thread");
    expect(ids("/achievements/42")).toContain("achievements");
    expect(ids("/gomosubs")).toContain("gomosubs");
    expect(ids("/g")).toContain("gomosubs");
  });

  it("keeps the /g list and /g/:slug entries apart", () => {
    // The board preloader must not fire for the g-sub catalogue, and vice versa.
    expect(ids("/g")).not.toContain("board");
    expect(ids("/g/test")).not.toContain("gomosubs");
  });

  it("skips warming a board for the static /g/create route", async () => {
    // `/g/:slug` matches `/g/create` at the pattern level, but the board
    // preloader must not fetch a board named "create".
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: null }) });
    vi.stubGlobal("fetch", fetchMock);

    await preloadRoute({
      pathname: "/g/create",
      search: "",
      hash: "",
      state: null,
      key: "test",
    } as Location);

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
