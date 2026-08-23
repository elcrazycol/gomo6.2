import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import Achievements from "./Achievements";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

vi.mock("react-router-dom", () => ({
  useParams: () => ({ userId: "profile-user-1" }),
  Link: ({ to, children, className }: any) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: () => <div data-testid="pentagram-loader">Loading...</div>,
}));

vi.mock("@/utils/storage", () => ({ storageUrl: () => null }));

// The page uses the light client (getCached) — let real fetches flow through
// the mock, but keep queryCache state isolated per test.
import { clearQueryCache } from "@/integrations/api/queryCache";

// ─── Fixtures (new catalog: i18n keys + category enum) ──────────────────────

const ACHIEVEMENTS = [
  {
    id: "a1",
    group_key: "entries",
    name: "achievements.entries.title",
    title: "achievements.entries.title",
    description: "",
    icon: "message-square",
    category: "content",
    rarity: "common",
    hidden: false,
    sort_order: 1,
    achievement_type: "progressive",
    levels: [
      { level: 1, threshold: 1, name_key: "achievements.entries.1.name", description_key: "achievements.entries.1.description", rarity: "common" },
    ],
  },
  {
    id: "a2",
    group_key: "daily_streak",
    name: "achievements.daily_streak.title",
    title: "achievements.daily_streak.title",
    description: "",
    icon: "calendar-check",
    category: "retention",
    rarity: "legendary",
    hidden: false,
    sort_order: 2,
    achievement_type: "progressive",
    levels: [
      { level: 1, threshold: 3, name_key: "achievements.daily_streak.1.name", description_key: "achievements.daily_streak.1.description", rarity: "common" },
    ],
  },
  {
    id: "a3",
    group_key: "secret_owl",
    name: "achievements.secret_owl.title",
    title: "achievements.secret_owl.title",
    description: "",
    icon: "moon-star",
    category: "secret",
    rarity: "rare",
    hidden: true,
    sort_order: 3,
    achievement_type: "one_time",
    levels: [
      { level: 1, threshold: 10, name_key: "achievements.secret_owl.1.name", description_key: "achievements.secret_owl.1.description", rarity: "rare" },
    ],
  },
  {
    id: "a4",
    group_key: "gift_sent",
    name: "achievements.gift_sent.title",
    title: "achievements.gift_sent.title",
    description: "",
    icon: "gift",
    category: "gifts",
    rarity: "uncommon",
    hidden: false,
    sort_order: 4,
    achievement_type: "one_time",
    levels: [
      { level: 1, threshold: 1, name_key: "achievements.gift_sent.1.name", description_key: "achievements.gift_sent.1.description", rarity: "uncommon" },
    ],
  },
];

function setupFetch({
  profile = { id: "profile-user-1", username: "testuser" },
  unlockedIds = ["a1"],
  achievements = ACHIEVEMENTS,
}: {
  profile?: { id: string; username: string } | null;
  unlockedIds?: string[];
  achievements?: typeof ACHIEVEMENTS;
} = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/profiles")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: profile ? [profile] : [] }),
      });
    }
    if (url.includes("/user_achievements")) {
      const data = unlockedIds.map((id) => ({
        achievement_id: id,
        current_level: 1,
        is_pinned: false,
        pinned_order: null,
        unlocked_at: "2025-01-01T00:00:00Z",
        progress_current: 0,
        achievements: { id },
      }));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data }) });
    }
    if (url.includes("/achievements")) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ data: achievements })),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
  });
}

beforeEach(() => {
  clearQueryCache();
  mockFetch.mockReset();
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Achievements page", () => {
  it("shows a loader while fetching", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<Achievements />);
    expect(screen.getByTestId("pentagram-loader")).toBeInTheDocument();
  });

  it("renders profile header and progress stats", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Достижения — testuser")).toBeInTheDocument();
    });
    expect(screen.getByText("Открыто 1 из 4")).toBeInTheDocument();
  });

  it("marks achievements as unlocked and shows rarity labels", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первое слово")).toBeInTheDocument();
    });
    // Section header now includes the count in one text node
    expect(screen.getByText("Открытые (1)")).toBeInTheDocument();
    // "Закрытые" appears as the locked section heading and the toggle label
    expect(screen.getAllByText("Закрытые").length).toBeGreaterThanOrEqual(1);
    // Unlocked card renders its rarity badge
    expect(screen.getAllByText("Обычное").length).toBeGreaterThanOrEqual(1);
  });

  it("filters achievements by search query", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первое слово")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Поиск достижений..."), {
      target: { value: "завсегд" },
    });

    expect(screen.queryByText("Первое слово")).not.toBeInTheDocument();
    expect(screen.getByText("Завсегдатай")).toBeInTheDocument();
  });

  it("clears the search via the X button", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первое слово")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Поиск достижений..."), {
      target: { value: "завсегд" },
    });
    expect(screen.queryByText("Первое слово")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Очистить поиск" }));
    expect(screen.getByText("Первое слово")).toBeInTheDocument();
  });

  it("filters by category chip", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первое слово")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Удержание/ }));

    expect(screen.queryByText("Первое слово")).not.toBeInTheDocument();
    expect(screen.getByText("Завсегдатай")).toBeInTheDocument();
  });

  it("toggles category off by clicking the active chip again", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первое слово")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Удержание/ }));
    fireEvent.click(screen.getByRole("button", { name: /Удержание/ }));

    expect(screen.getByText("Первое слово")).toBeInTheDocument();
  });

  it("hides locked achievements when the checkbox is off", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Завсегдатай")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Закрытые"));

    expect(screen.queryByText("Завсегдатай")).not.toBeInTheDocument();
    expect(screen.getByText("Первое слово")).toBeInTheDocument();
  });

  it("hides secret achievements when the secret toggle is off", async () => {
    setupFetch();
    render(<Achievements />);

    // Hidden locked achievements render as a "reveal" card, not by name
    await waitFor(() => {
      expect(screen.getByText("Секретное достижение")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Секретные"));

    expect(screen.queryByText("Секретное достижение")).not.toBeInTheDocument();
    expect(screen.getByText("Первое слово")).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первое слово")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Поиск достижений..."), {
      target: { value: "несуществующее" },
    });

    expect(screen.getByText("Ничего не найдено")).toBeInTheDocument();
  });

  it("handles a missing profile gracefully", async () => {
    setupFetch({ profile: null });
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Назад")).toBeInTheDocument();
    });
    expect(screen.getByText("Достижения")).toBeInTheDocument();
  });
});
