import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import DailyQuests, { formatAutoGranted } from "./DailyQuests";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("react-router-dom", () => ({
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
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

const QUEST = (over: Record<string, unknown> = {}) => ({
  key: "daily_likes",
  name_key: "achievements.daily.daily_likes.name",
  desc_key: "achievements.daily.daily_likes.description",
  threshold: 5,
  progress: 5,
  completed: true,
  claimed: false,
  can_claim: true,
  rewards: [{ kind: "drops", amount: 10 }],
  ...over,
});

const DAILY = {
  day: "2026-10-31",
  quests: [
    QUEST(),
    QUEST({
      key: "daily_comments",
      name_key: "achievements.daily.daily_comments.name",
      desc_key: "achievements.daily.daily_comments.description",
      threshold: 2,
      progress: 1,
      completed: false,
      claimed: false,
      can_claim: false,
      rewards: [{ kind: "drops", amount: 12 }],
    }),
  ],
  unclaimed_count: 1,
  full_claimed: false,
  streak: { current: 3, longest: 7 },
  chests: [],
  drops: 100,
};

function ok(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve({ success: true, data }),
    text: () => Promise.resolve(JSON.stringify({ success: true, data })),
  };
}

const openCalls: string[] = [];
const openOutcome = {
  rarity: "unusual",
  drops: 10,
  rewards: [],
  steps: [
    { type: "failed", rarity: "common", attempts_left: 4 },
    { type: "upgraded", rarity: "unusual", attempts_left: 5 },
    { type: "opened", rarity: "unusual", attempts_left: 0 },
  ],
};

function setupFetch(daily: unknown = DAILY) {
  openCalls.length = 0;
  mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
    if (String(url).includes("/quests/daily/claim") && opts?.method === "POST") {
      return Promise.resolve(ok({ granted: [{ kind: "drops", amount: 10 }] }));
    }
    if (String(url).includes("/quests/daily/restore") && opts?.method === "POST") {
      return Promise.resolve(ok({ streak: 4, price: 80 }));
    }
    if (String(url).includes("/quests/daily/chests/") && opts?.method === "POST") {
      openCalls.push(String(url));
      return Promise.resolve(ok(openOutcome));
    }
    if (String(url).includes("/quests/daily")) {
      return Promise.resolve(ok(daily));
    }
    return Promise.resolve(ok([]));
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

function renderPage() {
  return render(
    <MotionConfig reducedMotion="always">
      <DailyQuests />
    </MotionConfig>,
  );
}

describe("DailyQuests page", () => {
  it("renders the day with the streak and the quests", async () => {
    setupFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Ежедневные")).toBeInTheDocument();
    });
    expect(screen.getByText("Лайк-машина")).toBeInTheDocument();
    expect(screen.getByText("Собеседник")).toBeInTheDocument();
    // Streak chip shows the current series.
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("claims a quest with one POST and seals the row", async () => {
    setupFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Лайк-машина")).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByText("Забрать")[0]);

    await waitFor(() => {
      const posts = mockFetch.mock.calls.filter(
        ([url, opts]: any[]) =>
          typeof url === "string" &&
          url.includes("/quests/daily/claim") &&
          (opts as RequestInit)?.method === "POST",
      );
      expect(posts.length).toBe(1);
    });
    expect(await screen.findByText("Забрано")).toBeInTheDocument();
  });

  it("offers the streak buy-back when yesterday was missed", async () => {
    setupFetch({
      ...DAILY,
      streak: { current: 4, longest: 9, restorable_day: "2026-10-30", restore_price: 80 },
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Серия прервалась")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Восстановить серию"));

    await waitFor(() => {
      const posts = mockFetch.mock.calls.filter(
        ([url, opts]: any[]) =>
          typeof url === "string" &&
          url.includes("/quests/daily/restore") &&
          (opts as RequestInit)?.method === "POST",
      );
      expect(posts.length).toBe(1);
    });
    await waitFor(() => {
      expect(screen.queryByText("Серия прервалась")).not.toBeInTheDocument();
    });
  });

  it("formats the auto-grant toast line", () => {
    const t = (key: string, opts?: Record<string, unknown>) => {
      if (key === "quests.claimedDrops") return `+${opts?.count} ${opts?.label}`;
      if (key === "quests.chest") return "сундук";
      return "Вчерашнее долетело";
    };
    expect(
      formatAutoGranted(t, [
        { kind: "drops", amount: 40 },
        { kind: "chest", chest_id: "c9", mechanic: "rarity_chest" },
      ]),
    ).toBe("Вчерашнее долетело: +40 дропсов, сундук");
    expect(formatAutoGranted(t, [])).toBeNull();
  });

  it("marks the day as seen so the quests button drops its «!»", async () => {
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
    setupFetch();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Лайк-машина")).toBeInTheDocument();
    });
    expect(store["daily:seen:profile-user-1"]).toBe("2026-10-31");
  });

  it("opens a chest through the modal: server taps, dots, reward", async () => {
    setupFetch({
      ...DAILY,
      chests: [{ id: "c1", day: "2026-10-31", mechanic: "rarity_chest", created_at: "" }],
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Лайк-машина")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Открыть"));

    // The play call fires on mount and credits at once.
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(openCalls.length).toBe(1));
    const chest = within(dialog).getByRole("button", { name: /Осталось попыток: 5 из 5/ });

    fireEvent.click(chest);
    await waitFor(() =>
      within(dialog).getByRole("button", { name: /Осталось попыток: 4 из 5/ }),
    );
    fireEvent.click(chest);
    fireEvent.click(chest);

    await waitFor(() => expect(within(dialog).getByText("+10")).toBeInTheDocument());
    // No take button, no cross: any click dismisses (reward is credited).
    fireEvent.click(dialog);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // The vault row is gone — the chest was credited and removed.
    await waitFor(() => {
      expect(screen.queryByText("Открыть")).not.toBeInTheDocument();
    });
  });
});
