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

vi.stubGlobal("fetch", mockFetch);

vi.mock("@/integrations/api/compat", () => ({ api: { auth: mockAuth } }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [searchParamsHolder.params, vi.fn()],
}));
// recharts' ResponsiveContainer measures 0x0 in jsdom — stub the primitives so
// the assertions target the surrounding UI.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart">{children}</div>,
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

const detailedPayload = {
  user_id: FOREIGN_ID,
  username: "anon",
  can_view: true,
  stats_hidden: false,
  detailed: true,
  totals: {
    posts: 1,
    threads: 2,
    wall_posts: 3,
    comments: 4,
    likes_received: 5,
    likes_given: 6,
    views_received: 7,
    garma: 42,
    session_minutes: 300,
  },
  garma_breakdown: [{ key: "threads", weight: 4, raw: 10, value: 40 }],
  activity_daily: [{ date: "2026-09-29", events: 3 }],
  activity_days: 30,
  activity_series: { threads: [{ date: "2026-09-29", events: 10 }] },
  computed_at: "2026-09-30T00:00:00Z",
};

function setupStatsEndpoint(payload: unknown, targetUserId = FOREIGN_ID) {
  mockFetch.mockImplementation((url: string) => {
    if (url.startsWith(`/api/v1/users/${targetUserId}/stats`)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: payload }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: null }) });
  });
}

function setupLoggedIn() {
  mockAuth.getSession.mockResolvedValue({
    data: { session: { user: { id: SELF_ID }, access_token: "token-abc" } },
    error: null,
  });
}

let StatsComponent: React.ComponentType;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Stats", () => {
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

  it("hides a private profile the viewer may not see", async () => {
    searchParamsHolder.params = new URLSearchParams(`user=${FOREIGN_ID}`);
    setupStatsEndpoint({ ...detailedPayload, can_view: false, totals: null, garma_breakdown: null, activity_series: null });

    render(<StatsComponent />);

    await waitFor(() => {
      expect(screen.getByText("Статистика этого пользователя скрыта")).toBeInTheDocument();
    });
  });

  it("hides stats when the owner disabled them", async () => {
    searchParamsHolder.params = new URLSearchParams(`user=${FOREIGN_ID}`);
    setupStatsEndpoint({ ...detailedPayload, stats_hidden: true, totals: null, garma_breakdown: null, activity_series: null });

    render(<StatsComponent />);

    await waitFor(() => {
      expect(screen.getByText("Статистика этого пользователя скрыта")).toBeInTheDocument();
    });
  });

  it("renders totals and the exact garma breakdown when detailed", async () => {
    searchParamsHolder.params = new URLSearchParams(`user=${FOREIGN_ID}`);
    setupStatsEndpoint(detailedPayload);

    render(<StatsComponent />);

    await waitFor(() => {
      expect(screen.getByText("Статистика anon")).toBeInTheDocument();
    });
    expect(screen.getByText("42")).toBeInTheDocument(); // garma total
    expect(screen.getByText("Вклад в гарму")).toBeInTheDocument();
    expect(screen.getByText("Динамика")).toBeInTheDocument();
  });

  it("shows totals only when the owner hid detailed stats", async () => {
    searchParamsHolder.params = new URLSearchParams(`user=${FOREIGN_ID}`);
    setupStatsEndpoint({ ...detailedPayload, detailed: false, garma_breakdown: null, activity_series: null });

    render(<StatsComponent />);

    await waitFor(() => {
      expect(screen.getByText("Статистика anon")).toBeInTheDocument();
    });
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByText("Вклад в гарму")).not.toBeInTheDocument();
    expect(screen.getByText(/скрыл детальную статистику/i)).toBeInTheDocument();
  });

  it("loads the whole page with a single stats request", async () => {
    searchParamsHolder.params = new URLSearchParams(`user=${FOREIGN_ID}`);
    setupStatsEndpoint(detailedPayload);

    render(<StatsComponent />);

    await waitFor(() => {
      expect(screen.getByText("Статистика anon")).toBeInTheDocument();
    });
    const statsCalls = mockFetch.mock.calls.filter(([u]: [string]) => u.includes("/stats?"));
    expect(statsCalls).toHaveLength(1);
    expect(statsCalls[0][0]).toBe(`/api/v1/users/${FOREIGN_ID}/stats?days=30`);
  });
});
