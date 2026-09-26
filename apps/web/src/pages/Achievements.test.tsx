import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import Achievements from "./Achievements";
import { clearQueryCache } from "@/integrations/api/queryCache";

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

// ─── Fixtures (new catalog) ──────────────────────────────────────────────────

const MILESTONE = {
  achievement_id: "a1",
  current_level: 2,
  unlocked_at: "2025-01-01T00:00:00Z",
  progress_current: 120,
  achievements: {
    id: "a1",
    group_key: "entries",
    title: "achievements.entries.title",
    name: "achievements.entries.title",
    description: "",
    icon: "message-square",
    category: "content",
    kind: "milestone",
    origin: "code",
    image_url: null,
    level_images: {},
    owner_share: { "1": 12.5, "2": 4 },
    achievement_type: "progressive",
    hidden: false,
    levels: [
      {
        level: 1,
        threshold: 25,
        name_key: "achievements.entries.1.name",
        description_key: "achievements.entries.1.description",
      },
      {
        level: 2,
        threshold: 100,
        name_key: "achievements.entries.2.name",
        description_key: "achievements.entries.2.description",
      },
    ],
  },
};

const AWARD = {
  id: "g1",
  user_id: "profile-user-1",
  award_key: "award_bughunter",
  awarded_by: "u-demo",
  awarded_by_username: "demo",
  reason: "Поймал краш",
  awarded_at: "2026-02-01T00:00:00Z",
  award: {
    id: "w1",
    group_key: "award_bughunter",
    title: "achievements.award_bughunter.title",
    name: "achievements.award_bughunter.title",
    description: "achievements.award_bughunter.description",
    icon: "bug",
    category: "awards",
    origin: "code",
    image_url: null,
    level_images: {},
    owner_share: { "1": 0.8 },
  },
};

function setupFetch({
  profile = { id: "profile-user-1", username: "testuser" },
  milestones = [MILESTONE],
  awards = [AWARD],
}: {
  profile?: { id: string; username: string } | null;
  milestones?: typeof MILESTONE[];
  awards?: typeof AWARD[];
} = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/profiles")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: profile ? [profile] : [] }),
      });
    }
    if (url.includes("/user_achievements")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: milestones }) });
    }
    if (url.includes("/user_awards")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: awards }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
  });
}

beforeEach(() => {
  clearQueryCache();
  mockFetch.mockReset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Achievements page", () => {
  it("shows a loader while fetching", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<Achievements />);
    expect(screen.getByTestId("pentagram-loader")).toBeInTheDocument();
  });

  it("renders the trophy hall header and the total count", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Награды — testuser")).toBeInTheDocument();
    });
    // One milestone + one award.
    expect(screen.getByText("Наград: 2")).toBeInTheDocument();
    expect(screen.getByText("Вехи (1)")).toBeInTheDocument();
  });

  it("shows the current milestone level name and its owner share", async () => {
    setupFetch();
    render(<Achievements />);

    // Level 2 of "entries" is the unlocked trophy (art comes from the bundled
    // registry, so the name is the image alt rather than a text label).
    await waitFor(() => {
      expect(screen.getByAltText("Хронист")).toBeInTheDocument();
    });
    // The owner share lives in the badge corner, revealed on hover.
    expect(screen.getByText("4%")).toBeInTheDocument();
  });

  it("lists hand-granted awards with author, reason and date", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Ручные награды (1)")).toBeInTheDocument();
    });
    expect(screen.getByText("Баг-хантер")).toBeInTheDocument();
    expect(screen.getByText(/@demo/)).toBeInTheDocument();
    expect(screen.getByText("«Поймал краш»")).toBeInTheDocument();
  });

  it("shows an empty state when there are no trophies", async () => {
    setupFetch({ milestones: [], awards: [] });
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Пока нет наград")).toBeInTheDocument();
    });
  });

  it("handles a missing profile gracefully", async () => {
    setupFetch({ profile: null });
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Назад")).toBeInTheDocument();
    });
    expect(screen.getByText("Награды")).toBeInTheDocument();
  });
});
