import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, beforeAll, vi, afterAll } from "vitest";
import React from "react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockAuth, mockNavigate, searchParamsHolder } = vi.hoisted(() => ({
  mockAuth: { getSession: vi.fn() },
  mockNavigate: vi.fn(),
  searchParamsHolder: { params: new URLSearchParams("") },
}));

const mockFetch = vi.fn();

// Stub fetch for the whole file (mirrors Board.test.tsx / Profile.test.tsx):
// vitest isolates each test file, so the stub cannot leak into other files.
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/integrations/api/compat", () => ({ api: { auth: mockAuth } }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [searchParamsHolder.params, vi.fn()],
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
// recharts' ResponsiveContainer measures 0x0 in jsdom and renders nothing —
// stub the chart primitives so the assertions target the surrounding UI.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  Cell: () => null,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SELF_ID = "user-1";
const FOREIGN_ID = "foreign-1";

const profile = {
  username: "anon",
  garma: 42,
  post_count: 1,
  thread_count: 2,
  wall_post_count: 3,
  comment_count: 4,
  likes_received_count: 5,
};

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) });
}

function setupLoggedIn() {
  mockAuth.getSession.mockResolvedValue({
    data: { session: { user: { id: SELF_ID }, access_token: "token-abc" } },
    error: null,
  });
}

function setupFetchRoutes(opts: {
  targetUserId?: string;
  privacy?: Record<string, unknown>;
  friendsStatus?: "friends" | "none";
}) {
  const { targetUserId = FOREIGN_ID, privacy, friendsStatus = "none" } = opts;
  mockFetch.mockImplementation((url: string) => {
    if (url.startsWith("/api/v1/profiles?id=eq.")) {
      return jsonResponse([profile]);
    }
    if (url.startsWith(`/api/v1/users/${targetUserId}/privacy`)) {
      return jsonResponse(privacy);
    }
    if (url.startsWith("/api/v1/friends/status/")) {
      return jsonResponse({ status: friendsStatus });
    }
    // posts / threads / wall / rpc timestamps / session time — all empty.
    return jsonResponse([]);
  });
}

let StatsComponent: any;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Stats (privacy)", () => {
  beforeAll(async () => {
    const mod = await import("./Stats");
    StatsComponent = mod.default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    searchParamsHolder.params = new URLSearchParams("");
    setupLoggedIn();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("hides the stats of a foreign private profile from a non-friend", async () => {
    searchParamsHolder.params = new URLSearchParams(`user=${FOREIGN_ID}`);
    setupFetchRoutes({
      privacy: {
        private_profile: true,
        show_profile_stats: false,
        show_detailed_stats: false,
        stats_visibility: {},
      },
      friendsStatus: "none",
    });

    render(<StatsComponent />);

    await waitFor(() => {
      expect(screen.getByText("Статистика этого пользователя скрыта")).toBeInTheDocument();
    });
    // The stats page must use the public visibility endpoint for foreign
    // profiles — the scoped /privacy_settings would come back empty.
    expect(mockFetch).toHaveBeenCalledWith(`/api/v1/users/${FOREIGN_ID}/privacy`);
    expect(
      mockFetch.mock.calls.some(([u]: [string]) => u.startsWith("/api/v1/privacy_settings"))
    ).toBe(false);
  });

  it("shows stats to a friend of a private profile when toggles are on", async () => {
    searchParamsHolder.params = new URLSearchParams(`user=${FOREIGN_ID}`);
    setupFetchRoutes({
      privacy: {
        private_profile: true,
        show_profile_stats: true,
        show_detailed_stats: true,
        stats_visibility: { garma: true },
      },
      friendsStatus: "friends",
    });

    render(<StatsComponent />);

    await waitFor(() => {
      expect(screen.getByText("Статистика anon")).toBeInTheDocument();
    });
    expect(screen.getByText("42")).toBeInTheDocument(); // garma card
  });

  it("shows stats for a foreign public profile with toggles on", async () => {
    searchParamsHolder.params = new URLSearchParams(`user=${FOREIGN_ID}`);
    setupFetchRoutes({
      privacy: {
        private_profile: false,
        show_detailed_stats: true,
        stats_visibility: { garma: true },
      },
      friendsStatus: "none",
    });

    render(<StatsComponent />);

    await waitFor(() => {
      expect(screen.getByText("Статистика anon")).toBeInTheDocument();
    });
    expect(screen.getByText("42")).toBeInTheDocument(); // garma card
  });

  it("uses the scoped privacy_settings endpoint when viewing the own profile", async () => {
    setupFetchRoutes({
      targetUserId: SELF_ID,
      privacy: {
        private_profile: false,
        show_profile_stats: true,
        show_detailed_stats: true,
        stats_visibility: { garma: true },
      },
    });

    render(<StatsComponent />);

    await waitFor(() => {
      expect(screen.getByText("Статистика anon")).toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledWith(`/api/v1/privacy_settings?user_id=eq.${SELF_ID}`);
  });
});
