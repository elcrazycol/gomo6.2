import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import Achievements from "./Achievements";
import { clearQueryCache } from "@/integrations/api/queryCache";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

vi.mock("react-router-dom", () => ({
  useParams: () => ({ userId: "profile-user-1" }),
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

function setupFetch({
  profile = { id: "profile-user-1", username: "testuser" },
  quests = QUESTS,
  drops = 30,
  unclaimed = 1,
}: {
  profile?: { id: string; username: string } | null;
  quests?: typeof QUESTS;
  drops?: number;
  unclaimed?: number;
} = {}) {
  const ok = (data: unknown) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve({ success: true, data }),
    text: () => Promise.resolve(JSON.stringify({ success: true, data })),
  });
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/profiles")) {
      return Promise.resolve(ok(profile ? [profile] : []));
    }
    if (url.includes("/quests/progress")) {
      return Promise.resolve(
        ok({ user_id: "profile-user-1", drops, unclaimed_count: unclaimed, quests, chests: [] }),
      );
    }
    return Promise.resolve(ok([]));
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

  it("renders the quest header with the first-steps counter", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Квесты — testuser")).toBeInTheDocument();
    });
    expect(screen.getByText("Первые шаги: 1 из 1")).toBeInTheDocument();
  });

  it("shows a claim button for completed unclaimed levels", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Лицо")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Забрать").length).toBeGreaterThan(0);
    expect(screen.getByText("Забрано")).toBeInTheDocument();
  });

  it("shows progress for locked levels", async () => {
    setupFetch();
    render(<Achievements />);

    await waitFor(() => {
      expect(screen.getByText("Писатель")).toBeInTheDocument();
    });
    expect(screen.getByText("5/10")).toBeInTheDocument();
  });

  it("shows an empty state when there are no quests", async () => {
    setupFetch({ quests: [] });
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
    expect(screen.getByText("Квесты")).toBeInTheDocument();
  });

  it("sends a single claim request on fast double click", async () => {
    setupFetch();
    render(<Achievements />);

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
});
