import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShareCard } from "./ShareCard";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockFrom = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
    rpc: vi.fn(),
  },
}));

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, keyOrUrl?: string | null) => keyOrUrl || null,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

function chain(rows: unknown[]) {
  return {
    select: () => chain(rows),
    eq: () => chain(rows),
    limit: async () => ({ data: rows, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: null }),
  };
}

function renderCard(target: { type: "thread" | "wall"; id: string }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ShareCard target={target} />
    </QueryClientProvider>,
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ShareCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a thread card with title, snippet and board label", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "threads") {
        return chain([{
          id: "t1",
          title: "Заголовок записи",
          content: "Текст записи для карточки",
          image_url: null,
          image_urls: null,
          attachments: null,
          boards: { slug: "games", name: "Игры", is_gomosub: false },
          profiles: { username: "author", display_name: null, is_anonymous: false, avatar_url: null },
        }]);
      }
      return chain([]);
    });

    renderCard({ type: "thread", id: "t1" });

    expect(await screen.findByText("Заголовок записи")).toBeInTheDocument();
    expect(screen.getByText(/Текст записи для карточки/)).toBeInTheDocument();
    expect(screen.getByText(/Запись · \/games/)).toBeInTheDocument();
    expect(screen.getByText("@author")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("uses the /g/ prefix for gomosub boards", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "threads") {
        return chain([{
          id: "t1",
          title: "Запись",
          content: "",
          image_url: null,
          image_urls: null,
          attachments: null,
          boards: { slug: "gomo", name: "Gomo", is_gomosub: true },
          profiles: { username: "author", is_anonymous: false, avatar_url: null },
        }]);
      }
      return chain([]);
    });

    renderCard({ type: "thread", id: "t1" });
    await screen.findByText("Запись");
    expect(screen.getByText(/Запись · g\/gomo/)).toBeInTheDocument();
  });

  it("renders a wall post card with author and content", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "profile_wall_posts") {
        return chain([{
          id: "w1",
          user_id: "u1",
          content: "Запись со стены",
          image_url: null,
          attachments: null,
          author: { username: "bob", display_name: null, is_anonymous: false, avatar_url: null },
        }]);
      }
      return chain([]);
    });

    renderCard({ type: "wall", id: "w1" });

    // The label and the content snippet both say "Запись со стены".
    expect(await screen.findAllByText("Запись со стены")).toHaveLength(2);
    expect(screen.getByText("@bob")).toBeInTheDocument();
  });

  it("renders the first image attachment as the card thumbnail", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "threads") {
        return chain([{
          id: "t1",
          title: "С фото",
          content: "",
          image_url: null,
          image_urls: null,
          attachments: [{ type: "image", url: "photo.jpg", mime: "image/jpeg", name: "photo", size: 1 }],
          boards: { slug: "b", name: "Board", is_gomosub: false },
          profiles: { username: "author", is_anonymous: false, avatar_url: null },
        }]);
      }
      return chain([]);
    });

    const { container } = renderCard({ type: "thread", id: "t1" });
    await screen.findByText("С фото");
    const img = container.querySelector(".msg-share-card-image img");
    expect(img).toHaveAttribute("src", "photo.jpg");
  });

  it("navigates to the thread on card click", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "threads") {
        return chain([{
          id: "t1",
          title: "Заголовок",
          content: "",
          image_url: null,
          image_urls: null,
          attachments: null,
          boards: { slug: "games", name: "Игры", is_gomosub: false },
          profiles: { username: "author", is_anonymous: false, avatar_url: null },
        }]);
      }
      return chain([]);
    });

    renderCard({ type: "thread", id: "t1" });
    await screen.findByText("Заголовок");
    await userEvent.click(screen.getByRole("button"));
    expect(mockNavigate).toHaveBeenCalledWith("/games/thread/t1");
  });

  it("navigates to the wall post on card click", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "profile_wall_posts") {
        return chain([{
          id: "w1",
          user_id: "u1",
          content: "Запись",
          image_url: null,
          attachments: null,
          author: { username: "bob", is_anonymous: false, avatar_url: null },
        }]);
      }
      return chain([]);
    });

    renderCard({ type: "wall", id: "w1" });
    await screen.findByText("Запись");
    await userEvent.click(screen.getByRole("button"));
    expect(mockNavigate).toHaveBeenCalledWith("/profile/u1/wall/w1");
  });

  it("falls back to a muted card when the entity is gone", async () => {
    mockFrom.mockImplementation(() => chain([]));
    renderCard({ type: "wall", id: "missing" });
    expect(await screen.findByText("Запись недоступна")).toBeInTheDocument();
  });

  it("shows a loading placeholder while the entity is fetched", () => {
    // A never-resolving promise keeps the query in the loading state.
    mockFrom.mockImplementation(() => ({
      select: () => ({ eq: () => ({ limit: () => new Promise(() => {}) }) }),
    }));

    renderCard({ type: "thread", id: "t1" });
    expect(screen.getByText("Загрузка...")).toBeInTheDocument();
  });
});
