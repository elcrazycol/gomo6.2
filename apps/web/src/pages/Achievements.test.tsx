import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import Achievements from "./Achievements";
import { clearQueryCache } from "@/integrations/api/queryCache";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

// Controllable router: the toast deep-link rides in location.state.
const routerCtl = vi.hoisted(() => ({ state: null as unknown, calls: [] as any[] }));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ userId: "profile-user-1" }),
  useNavigate: () => (to: any, opts: any) => {
    routerCtl.calls.push([to, opts]);
  },
  useLocation: () => ({ pathname: "/achievements/profile-user-1", state: routerCtl.state }),
  Link: ({ to, children, className }: any) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: () => <div data-testid="pentagram-loader">Loading...</div>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "profile-user-1" } }),
}));

// ─── Fixtures (quests MVP) ───────────────────────────────────────────────────

const QUESTS = [
  {
    group_key: "qs_avatar",
    title_key: "achievements.qs_avatar.title",
    category: "profile",
    track: "first_steps",
    icon: "smile",
    sort_order: 1,
    current_level: 1,
    progress_current: 1,
    levels: [
      {
        level: 1,
        threshold: 1,
        name_key: "achievements.qs_avatar.1.name",
        description_key: "achievements.qs_avatar.1.description",
        rewards: [{ kind: "drops", amount: 20 }],
        completed: true,
        claimed: false,
        can_claim: true,
      },
    ],
  },
  {
    group_key: "entries",
    title_key: "achievements.entries.title",
    category: "content",
    track: "main",
    icon: "notebook-pen",
    sort_order: 20,
    current_level: 1,
    progress_current: 5,
    levels: [
      {
        level: 1,
        threshold: 1,
        name_key: "achievements.entries.1.name",
        description_key: "achievements.entries.1.description",
        rewards: [{ kind: "drops", amount: 10 }],
        completed: true,
        claimed: true,
        can_claim: false,
      },
      {
        level: 2,
        threshold: 10,
        name_key: "achievements.entries.2.name",
        description_key: "achievements.entries.2.description",
        rewards: [{ kind: "drops", amount: 25 }],
        completed: false,
        claimed: false,
        can_claim: false,
      },
    ],
  },
];

const DAILY = {
  day: "2026-10-31",
  quests: [
    {
      key: "daily_likes",
      name_key: "achievements.daily.daily_likes.name",
      desc_key: "achievements.daily.daily_likes.description",
      threshold: 5,
      progress: 5,
      completed: true,
      claimed: false,
      can_claim: true,
      rewards: [{ kind: "drops", amount: 10 }],
    },
    {
      key: "daily_comments",
      name_key: "achievements.daily.daily_comments.name",
      desc_key: "achievements.daily.daily_comments.description",
      threshold: 2,
      progress: 1,
      completed: false,
      claimed: false,
      can_claim: false,
      rewards: [{ kind: "drops", amount: 12 }],
    },
  ],
  unclaimed_count: 2,
  full_claimed: false,
  streak: { current: 3, longest: 7 },
  chests: [],
  drops: 100,
};

function setupFetch({
  profile = { id: "profile-user-1", username: "testuser" },
  quests = QUESTS,
  drops = 30,
  unclaimed = 1,
  recalcAvailable = false,
  catalogUpdatedAt = "",
  daily = DAILY,
}: {
  profile?: { id: string; username: string } | null;
  quests?: typeof QUESTS;
  drops?: number;
  unclaimed?: number;
  recalcAvailable?: boolean;
  catalogUpdatedAt?: string;
  daily?: typeof DAILY;
} = {}) {
  const ok = (data: unknown) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve({ success: true, data }),
    text: () => Promise.resolve(JSON.stringify({ success: true, data })),
  });
  mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/profiles")) {
      return Promise.resolve(ok(profile ? [profile] : []));
    }
    if (url.includes("/quests/daily")) {
      return Promise.resolve(ok(daily));
    }
    if (url.includes("/quests/reconcile") && opts?.method === "POST") {
      return Promise.resolve(ok({ topped_up: [] }));
    }
    if (url.includes("/quests/progress")) {
      return Promise.resolve(
        ok({
          user_id: "profile-user-1",
          drops,
          unclaimed_count: unclaimed,
          recalc_available: recalcAvailable,
          catalog_updated_at: catalogUpdatedAt,
          quests,
          chests: [],
        }),
      );
    }
    return Promise.resolve(ok([]));
  });
}

beforeEach(() => {
  clearQueryCache();
  mockFetch.mockReset();
  routerCtl.state = null;
  routerCtl.calls = [];
});

// Motion reduced to instant: AnimatePresence exits settle synchronously,
// so collapse/focus-swap assertions don't depend on spring timing in jsdom.
function renderPage() {
  return render(
    <MotionConfig reducedMotion="always">
      <Achievements />
    </MotionConfig>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Achievements page", () => {
  it("shows a loader while fetching", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId("pentagram-loader")).toBeInTheDocument();
  });

  it("renders the quest header with the first-steps counter", async () => {
    setupFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Квесты — testuser")).toBeInTheDocument();
    });
    expect(screen.getByText("Первые шаги: 1 из 1")).toBeInTheDocument();
  });

  it("shows a claim button for completed unclaimed levels", async () => {
    setupFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Лицо")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Забрать").length).toBeGreaterThan(0);
    // The claimed entries rung hides inside the collapsed ladder card.
    fireEvent.click(screen.getAllByLabelText("Все уровни")[0]);
    expect(await screen.findByText("Забрано")).toBeInTheDocument();
  });

  it("collapses each ladder to the focused level until expanded", async () => {
    setupFetch();
    renderPage();

    // entries: L1 claimed, L2 in progress → the card shows only L2.
    await waitFor(() => {
      expect(screen.getByText("Писатель")).toBeInTheDocument();
    });
    {
      const all = screen.getAllByText("Писатель");
      console.log("PISATEL_COUNT:" + all.length);
      console.log("BODY_CARDS:" + document.querySelectorAll("main").length);
    }
    expect(screen.queryByText("Пробы пера")).not.toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText("Все уровни")[0]);
    expect(await screen.findByText("Пробы пера")).toBeInTheDocument();
    expect(screen.getByText("Писатель")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Свернуть"));
    await waitFor(() => {
      expect(screen.queryByText("Пробы пера")).not.toBeInTheDocument();
    });
  });

  it("advances the focused card after a claim", async () => {
    const ladder = [
      {
        group_key: "entries",
        title_key: "achievements.entries.title",
        category: "content",
        track: "main",
        icon: "notebook-pen",
        sort_order: 20,
        current_level: 2,
        progress_current: 30,
        levels: [
          {
            level: 1,
            threshold: 1,
            name_key: "achievements.entries.1.name",
            description_key: "achievements.entries.1.description",
            rewards: [{ kind: "drops", amount: 8 }],
            completed: true,
            claimed: true,
            can_claim: false,
          },
          {
            level: 2,
            threshold: 10,
            name_key: "achievements.entries.2.name",
            description_key: "achievements.entries.2.description",
            rewards: [{ kind: "drops", amount: 20 }],
            completed: true,
            claimed: false,
            can_claim: true,
          },
          {
            level: 3,
            threshold: 25,
            name_key: "achievements.entries.3.name",
            description_key: "achievements.entries.3.description",
            rewards: [{ kind: "drops", amount: 45 }],
            completed: false,
            claimed: false,
            can_claim: false,
          },
        ],
      },
    ];
    const ok = (data: unknown) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve({ success: true, data }),
      text: () => Promise.resolve(JSON.stringify({ success: true, data })),
    });
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes("/profiles")) {
        return Promise.resolve(ok([{ id: "profile-user-1", username: "testuser" }]));
      }
      if (url.includes("/quests/claim") && opts?.method === "POST") {
        return Promise.resolve(ok({ granted: [{ kind: "drops", amount: 20 }] }));
      }
      if (url.includes("/quests/progress")) {
        return Promise.resolve(
          ok({ user_id: "profile-user-1", drops: 30, unclaimed_count: 1, quests: ladder, chests: [] }),
        );
      }
      return Promise.resolve(ok([]));
    });
    renderPage();

    // Focus is the claimable L2; claiming flips the card to L3.
    await waitFor(() => {
      expect(screen.getByText("Писатель")).toBeInTheDocument();
    });
    expect(screen.queryByText("Летописец")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Забрать"));

    await waitFor(() => {
      expect(screen.getByText("Летописец")).toBeInTheDocument();
    });
    // The outgoing card leaves with its exit spring — wait for it, don't
    // assert instantly.
    await waitFor(() => {
      expect(screen.queryByText("Писатель")).not.toBeInTheDocument();
    });
  });

  it("scrolls to and blinks the quest opened from the unlock toast", async () => {
    routerCtl.state = { focusQuest: "entries" };
    setupFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Писатель")).toBeInTheDocument();
    });
    const card = document.getElementById("quest-entries");
    expect(card).not.toBeNull();
    expect(card?.className).toMatch(/ring-primary/);
    // The neighbour card stays calm.
    expect(document.getElementById("quest-qs_avatar")?.className).not.toMatch(/ring-primary/);
    // The deep-link state is consumed so re-renders don't blink again.
    expect(routerCtl.calls).toContainEqual(["/achievements/profile-user-1", { replace: true }]);
  });

  it("blinks a first-steps row opened from the unlock toast", async () => {
    routerCtl.state = { focusQuest: "qs_avatar" };
    setupFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Лицо")).toBeInTheDocument();
    });
    const row = document.getElementById("quest-qs_avatar");
    expect(row?.className).toMatch(/bg-primary/);
    expect(routerCtl.calls).toContainEqual(["/achievements/profile-user-1", { replace: true }]);
  });

  it("ignores an unknown toast quest without crashing", async () => {
    routerCtl.state = { focusQuest: "nope" };
    setupFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Писатель")).toBeInTheDocument();
    });
    expect(document.getElementById("quest-nope")).toBeNull();
    expect(routerCtl.calls).toContainEqual(["/achievements/profile-user-1", { replace: true }]);
  });

  it("links to the daily quests with the claimable count", async () => {
    setupFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Ежедневные")).toBeInTheDocument();
    });
    const link = screen.getByRole("link", { name: /Ежедневные/ });
    expect(link.getAttribute("href")).toBe("/achievements/daily");
    expect(screen.getByText("Выполнено 1 из 2")).toBeInTheDocument();
  });

  it("raises «!» on the daily button for an unvisited day", async () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
    setupFetch({ daily: { ...DAILY, quests: [], unclaimed_count: 0 } });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Ежедневные")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Новые задания")).toBeInTheDocument();
  });

  it("stays quiet on a plain restart with no seen version", async () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
    setupFetch({ recalcAvailable: false, catalogUpdatedAt: "2026-10-31T00:00:00Z" });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Лицо")).toBeInTheDocument();
    });
    // A newer catalog timestamp alone (backend restart bump) raises nothing
    // without a stored seen version to differ from.
    expect(screen.queryByText("Квесты обновлены")).not.toBeInTheDocument();
  });

  it("shows progress for locked levels", async () => {
    setupFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Писатель")).toBeInTheDocument();
    });
    expect(screen.getByText("5/10")).toBeInTheDocument();
  });

  it("shows an empty state when there are no quests", async () => {
    setupFetch({ quests: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Пока нет наград")).toBeInTheDocument();
    });
  });

  it("handles a missing profile gracefully", async () => {
    setupFetch({ profile: null });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Назад")).toBeInTheDocument();
    });
    expect(screen.getByText("Квесты")).toBeInTheDocument();
  });

  it("sends a single claim request on fast double click", async () => {
    setupFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Лицо")).toBeInTheDocument();
    });
    const btn = screen.getAllByText("Забрать")[0];
    fireEvent.click(btn);
    fireEvent.click(btn);

    await waitFor(() => {
      const posts = mockFetch.mock.calls.filter(
        ([url, opts]: any[]) =>
          typeof url === "string" &&
          url.includes("/quests/claim") &&
          (opts as RequestInit)?.method === "POST",
      );
      expect(posts.length).toBe(1);
    });
  });

  it("shows the rework banner and checks rewards on click", async () => {
    setupFetch({ recalcAvailable: true, catalogUpdatedAt: "2026-10-31T00:00:00Z" });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Квесты обновлены")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Проверить награды"));

    await waitFor(() => {
      const posts = mockFetch.mock.calls.filter(
        ([url, opts]: any[]) =>
          typeof url === "string" &&
          url.includes("/quests/reconcile") &&
          (opts as RequestInit)?.method === "POST",
      );
      expect(posts.length).toBe(1);
    });
  });

  it("hides the rework banner once the catalog version is seen", async () => {
    const store: Record<string, string> = { "quests:catalog:seen:profile-user-1": "seen-v1" };
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    });
    setupFetch({ recalcAvailable: false, catalogUpdatedAt: "seen-v1" });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Квесты — testuser")).toBeInTheDocument();
    });
    expect(screen.queryByText("Квесты обновлены")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", mockFetch);
  });


});
