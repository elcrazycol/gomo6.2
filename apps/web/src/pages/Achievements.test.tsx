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

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ACHIEVEMENTS = [
  {
    id: "a1",
    name: "Первый пост",
    description: "Опубликуй первый пост",
    icon: "message-square",
    category: "posting",
    rarity: "common",
    hidden: false,
    sort_order: 1,
    levels: [],
  },
  {
    id: "a2",
    name: "Легенда форума",
    description: "Создай 100 тредов",
    icon: "layers",
    category: "threads",
    rarity: "legendary",
    hidden: false,
    sort_order: 2,
    levels: [],
  },
  {
    id: "a3",
    name: "Секретка",
    description: "Тайное достижение",
    icon: "sparkles",
    category: "secret",
    rarity: "rare",
    hidden: true,
    sort_order: 3,
    levels: [],
  },
  {
    id: "a4",
    name: "Необычное",
    description: "Редкое событие",
    icon: "heart",
    category: "profile",
    rarity: "uncommon",
    hidden: false,
    sort_order: 4,
    levels: [],
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
    expect(screen.getByText("1 из 4 открыто")).toBeInTheDocument();
  });

  it("marks achievements as unlocked and shows rarity labels", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первый пост")).toBeInTheDocument();
    });
    expect(screen.getByText("Открытые")).toBeInTheDocument();
    // "Закрытые" appears both as a section heading and as a toggle label
    expect(screen.getAllByText("Закрытые").length).toBeGreaterThanOrEqual(1);
    // Unlocked section header shows count
    expect(screen.getByText(/\(1\)/)).toBeInTheDocument();
    // Unlocked card renders its rarity badge
    expect(screen.getAllByText("Обычное").length).toBeGreaterThanOrEqual(1);
  });

  it("filters achievements by search query", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первый пост")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Поиск достижений..."), {
      target: { value: "легенд" },
    });

    expect(screen.queryByText("Первый пост")).not.toBeInTheDocument();
    expect(screen.getByText("Легенда форума")).toBeInTheDocument();
  });

  it("clears the search via the X button", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первый пост")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Поиск достижений..."), {
      target: { value: "легенд" },
    });
    expect(screen.queryByText("Первый пост")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Очистить поиск" }));
    expect(screen.getByText("Первый пост")).toBeInTheDocument();
  });

  it("filters by category chip", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первый пост")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Треды" }));

    expect(screen.queryByText("Первый пост")).not.toBeInTheDocument();
    expect(screen.getByText("Легенда форума")).toBeInTheDocument();
  });

  it("toggles category off by clicking the active chip again", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первый пост")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Треды" }));
    fireEvent.click(screen.getByRole("button", { name: "Треды" }));

    expect(screen.getByText("Первый пост")).toBeInTheDocument();
  });

  it("hides locked achievements when the checkbox is off", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Легенда форума")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Закрытые"));

    expect(screen.queryByText("Легенда форума")).not.toBeInTheDocument();
    expect(screen.getByText("Первый пост")).toBeInTheDocument();
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
    expect(screen.getByText("Первый пост")).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Первый пост")).toBeInTheDocument();
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
