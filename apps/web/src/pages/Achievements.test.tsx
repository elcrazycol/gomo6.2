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

// Controlled mocks: tests rewire the current-user identity and the rpc fn.
const mocks = vi.hoisted(() => ({
  mockCurrentUser: { id: null as string | null },
  rpcMock: vi.fn(() => Promise.resolve({ error: null, data: true })),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mocks.mockCurrentUser }),
}));

vi.mock("@/integrations/api/compat", () => ({
  api: {
    rpc: mocks.rpcMock,
  },
}));

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
  pinnedIds = [],
  achievements = ACHIEVEMENTS,
}: {
  profile?: { id: string; username: string } | null;
  unlockedIds?: string[];
  pinnedIds?: string[];
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
        is_pinned: pinnedIds.includes(id),
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
  mocks.rpcMock.mockClear();
  mocks.mockCurrentUser = { id: null };
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
    expect(screen.getByText("Открыто 1 из 3")).toBeInTheDocument();
  });

  it("marks achievements as unlocked and shows rarity labels", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первое слово")).toBeInTheDocument();
    });
    // Section header now includes the count in one text node
    expect(screen.getByText("Открытые (1)")).toBeInTheDocument();
    // Unlocked card renders its rarity badge
    expect(screen.getAllByText("Обычное").length).toBeGreaterThanOrEqual(1);
  });

  it("hides locked secret achievements entirely", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первое слово")).toBeInTheDocument();
    });
    // a3 is hidden + locked: no reveal card, no name — invisible.
    expect(screen.queryByText("Секретное достижение")).not.toBeInTheDocument();
    expect(screen.queryByText("Сова")).not.toBeInTheDocument();
    // Only non-secret locked achievements show up in the locked section (a2 + a4).
    expect(screen.getByText("Закрытые (2)")).toBeInTheDocument();
  });

  it("shows secret achievements once unlocked", async () => {
    setupFetch({ unlockedIds: ["a1", "a3"] });
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первое слово")).toBeInTheDocument();
    });
    // Unlocked secret appears by name, no reveal card needed.
    expect(screen.getByText("Сова")).toBeInTheDocument();
  });

  it("does not render pin buttons for other users", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первое слово")).toBeInTheDocument();
    });
    expect(screen.queryByTitle("Закрепить")).not.toBeInTheDocument();
  });

  it("toggles pin for the current user's profile", async () => {
    mocks.mockCurrentUser = { id: "profile-user-1" };

    setupFetch({ pinnedIds: ["a1"] });
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByTitle("Открепить")).toBeInTheDocument();
    });
    expect(screen.getByText("Закреплено: 1/6")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Открепить"));
    await waitFor(() => {
      expect(mocks.rpcMock).toHaveBeenCalledWith("toggle_achievement_pin", {
        _user_id: "profile-user-1",
        _achievement_id: "a1",
      });
    });
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
