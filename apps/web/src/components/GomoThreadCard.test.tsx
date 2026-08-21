import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, beforeEach, vi, beforeAll } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "2 дня назад",
}));

const mockFrom = vi.fn();
const mockNavigateFn = vi.fn();
const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
const deleteFn = vi.fn(() => {
  const chain = Promise.resolve({ data: null, error: null }) as any;
  chain.eq = () => chain;
  return chain;
});

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
    rpc: vi.fn(),
  },
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigateFn,
  };
});

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, keyOrUrl?: string | null) => keyOrUrl || null,
}));

vi.mock("@/components/UserBadge", () => ({
  UserBadge: ({ username, isAnonymous }: any) => (
    <span data-testid="user-badge" data-anonymous={!!isAnonymous}>
      {username || "Аноним"}
    </span>
  ),
}));

vi.mock("@/components/ProcessedContent", () => ({
  ProcessedContent: ({ content }: any) => (
    <span data-testid="processed-content">{content}</span>
  ),
}));

vi.mock("@/components/WallAttachments", () => ({
  WallAttachments: ({ attachments, onImageClick }: any) => (
    <button
      data-testid="wall-attachments"
      data-count={attachments.length}
      onClick={() =>
        onImageClick(
          attachments.map((a: any) => ({ url: a.url, type: "image", name: "x" })),
          0,
        )
      }
    />
  ),
}));

vi.mock("@/components/share/ShareSheet", () => ({
  ShareSheet: ({ open }: any) => (open ? <div data-testid="share-sheet" /> : null),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { GomoThreadCard, type GomoThread } from "@/components/GomoThreadCard";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const baseThread = (overrides: Partial<GomoThread> = {}): GomoThread => ({
  id: "t1",
  title: "Заголовок записи",
  content: "Текст записи",
  content_json: null,
  image_url: null,
  image_urls: null,
  attachments: null,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
  user_id: "u1",
  post_count: 3,
  tags: null,
  profiles: { username: "lesha", display_name: null, nickname_emoji_id: null, is_anonymous: false, avatar_url: null },
  ...overrides,
});

const renderCard = (thread: GomoThread, props: Partial<Parameters<typeof GomoThreadCard>[0]> = {}) =>
  render(
    <MemoryRouter>
      <GomoThreadCard
        thread={thread}
        currentUserId="me"
        currentUsername="me"
        boardPath="/g/test"
        onImageClick={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeAll(() => {
  // userEvent needs matchMedia stubs on jsdom
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })) as any;
  Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GomoThreadCard", () => {
  it("renders author, title and content (no channel chips)", () => {
    renderCard(baseThread());
    expect(screen.getByTestId("user-badge")).toHaveTextContent("lesha");
    expect(screen.getByText("Заголовок записи")).toBeInTheDocument();
    expect(screen.getByTestId("processed-content")).toHaveTextContent("Текст записи");
    expect(screen.queryByText("# Разработка")).not.toBeInTheDocument();
    expect(screen.queryByText("в g/test/")).not.toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument(); // post_count
  });

  it("shows a hint instead of content with visibility tags", () => {
    renderCard(baseThread({ content: "скрыто [seeusers=x]" }));
    expect(screen.getByText("зайдите в запись чтобы посмотреть")).toBeInTheDocument();
  });

  it("renders gomosub tags", () => {
    renderCard(baseThread({ tags: { gomosub_tags: ["anime", "games"] } }));
    expect(screen.getByText("#anime")).toBeInTheDocument();
    expect(screen.getByText("#games")).toBeInTheDocument();
  });

  it("passes attachments to the gallery grid", () => {
    renderCard(
      baseThread({
        image_urls: ["rich.jpg", "b.jpg"],
        attachments: JSON.stringify([
          { url: "rich.jpg", type: "image", mime: "image/jpeg", name: "r", size: 1, meta: { preview_key: "pk" } },
        ]),
      }),
    );
    expect(screen.getByTestId("wall-attachments").dataset.count).toBe("2");
  });

  it("does not render the latest answer preview anymore", () => {
    renderCard(
      baseThread({
        latest_post: {
          content: "Последний ответ в записи",
          created_at: "2026-08-01T12:00:00Z",
          user_id: "u2",
          profiles: { username: "anon", display_name: null, nickname_emoji_id: null, is_anonymous: true, avatar_url: null },
        },
      }),
    );
    expect(screen.queryByText(/Последний ответ в записи/)).not.toBeInTheDocument();
  });

  it("toggles a like via thread_likes", async () => {
    const user = userEvent.setup();
    const chain = { delete: deleteFn, insert: insertFn };
    mockFrom.mockReturnValue(chain);
    renderCard(baseThread());

    await user.click(screen.getByRole("button", { name: /Нравится/i }));
    expect(mockFrom).toHaveBeenCalledWith("thread_likes");
    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
  });

  it("opens the share sheet", async () => {
    const user = userEvent.setup();
    renderCard(baseThread());
    expect(screen.queryByTestId("share-sheet")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /share|оделиться/i }));
    expect(screen.getByTestId("share-sheet")).toBeInTheDocument();
  });

  it("navigates to the thread when tapping the card body", async () => {
    const user = userEvent.setup();
    renderCard(baseThread());
    await user.click(screen.getByTestId("processed-content"));
    expect(mockNavigateFn).toHaveBeenCalledWith("/g/test/thread/t1");
  });
});
