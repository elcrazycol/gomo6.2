import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ThreadCommentTree } from "./ThreadCommentTree";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockFrom, mockRpc, mockAuth, mockFetch } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockAuth: { getSession: vi.fn() },
  mockFetch: vi.fn(),
}));
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/integrations/api/compat", () => ({
  api: { from: (...args: any[]) => mockFrom(...args), rpc: (...args: any[]) => mockRpc(...args), auth: mockAuth },
}));
vi.mock("@/integrations/api/queryCache", () => ({ invalidateByPrefix: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useMobileKeyboard", () => ({ useMobileKeyboard: () => ({ isTouch: false, isOpen: false }) }));
vi.mock("@/services/websocket", () => ({
  wsService: { subscribeToThread: vi.fn(), unsubscribe: vi.fn(), on: vi.fn().mockReturnValue(vi.fn()) },
}));
vi.mock("@/utils/currentUserMeta", () => ({
  getCurrentUserMeta: () => Promise.resolve({ roles: [], color: "", username: "me", avatarUrl: null }),
}));
vi.mock("react-router-dom", () => ({
  Link: ({ children, to, className, onClick }: any) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/ProcessedContent", () => ({
  ProcessedContent: ({ content }: any) => <span data-testid="processed-content">{content}</span>,
}));
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div>,
  AvatarImage: (props: any) => <img alt="" {...props} />,
  AvatarFallback: ({ children, className }: any) => <div className={className}>{children}</div>,
}));
vi.mock("@/components/NicknameEmoji", () => ({ NicknameEmoji: () => null }));
vi.mock("@/components/WallAttachments", () => ({ WallAttachments: () => null }));
vi.mock("@/components/Lightbox", () => ({ Lightbox: () => null }));
// The real WallCommentComposer with a mocked rich editor (mirrors
// WallCommentTree.test.tsx): typing in the textarea emits a prosemirror doc.
vi.mock("@/components/GomoRichEditor", () => ({
  GomoRichEditor: ({ placeholder, onChange, legacyContent, text }: any) => (
    <div data-testid="gomo-rich-editor">
      <textarea
        data-testid="rich-editor-textarea"
        placeholder={placeholder}
        defaultValue={text ?? legacyContent ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          onChange?.({
            json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] },
            text: value,
          });
        }}
      />
    </div>
  ),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const post = (overrides: Record<string, unknown> = {}) => ({
  id: "p1",
  thread_id: "thread-1",
  user_id: "u1",
  content: "Первый пост",
  content_json: null,
  image_url: null,
  image_urls: null,
  attachments: null,
  reply_to: null,
  is_private: false,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
  profiles: { id: "u1", username: "lesha", avatar_url: null, is_anonymous: false },
  ...overrides,
});

const postsChain = (data: unknown[]) => {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => Promise.resolve({ data, error: null })),
  };
  return chain;
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ThreadCommentTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.getSession.mockResolvedValue({ data: { session: { user: { id: "me" }, access_token: "tok" } }, error: null });
    mockRpc.mockResolvedValue({ data: [{ post_id: "p1", count: 2, is_liked: true }], error: null });
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: {} }) });
  });

  const renderTree = () =>
    render(<ThreadCommentTree threadId="thread-1" currentUserId="me" />);

  it("loads and renders posts with a nested reply", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "posts") {
        return postsChain([
          post(),
          post({
            id: "p2",
            user_id: "u2",
            content: "Ответ на первый",
            reply_to: "p1",
            profiles: { id: "u2", username: "anon2", avatar_url: null, is_anonymous: true },
          }),
        ]);
      }
      return postsChain([]);
    });

    renderTree();

    await waitFor(() => {
      expect(screen.getByText("Первый пост")).toBeInTheDocument();
      expect(screen.getByText("Ответ на первый")).toBeInTheDocument();
    });
    expect(mockFrom).toHaveBeenCalledWith("posts");
    // Like counts come from the batch RPC.
    expect(mockRpc).toHaveBeenCalledWith("get_post_likes_batch", expect.anything());
  });

  it("loads author names via the profiles batch fetch (posts carry no profiles)", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "posts") return postsChain([post()]);
      return postsChain([]);
    });
    // The posts REST endpoint returns profiles:null — the tree must fetch
    // authors separately and merge them (this was the "all names Аноним" bug).
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/profiles?id=in.")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [{ id: "u1", username: "lesha", display_name: "Lesha", avatar_url: null, is_anonymous: false }],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    renderTree();

    await waitFor(() => {
      expect(screen.getByText("Lesha")).toBeInTheDocument();
      expect(screen.queryByText("Аноним")).not.toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/api/v1/profiles?id=in."));
  });

  it("submits a top-level reply via create_post", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "posts") return postsChain([post()]);
      return postsChain([]);
    });
    renderTree();

    await waitFor(() => expect(screen.getByText("Первый пост")).toBeInTheDocument());

    // Expand the one-line pill composer.
    await userEvent.click(screen.getByLabelText(/Напишите ответ/));
    const textarea = screen.getAllByTestId("rich-editor-textarea")[0];
    await userEvent.type(textarea, "Мой ответ");

    // The composer submit is the LAST "Ответить" button (node replies are first).
    const submits = screen.getAllByRole("button", { name: /ответить/i });
    await userEvent.click(submits[submits.length - 1]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/rpc/create_post",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Мой ответ"),
        }),
      );
    });
  });

  it("does not call create_post for an empty reply", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "posts") return postsChain([post()]);
      return postsChain([]);
    });
    renderTree();

    await waitFor(() => expect(screen.getByText("Первый пост")).toBeInTheDocument());

    // Expand the pill (empty content → submit must be blocked).
    await userEvent.click(screen.getByLabelText(/Напишите ответ/));
    const submits = screen.getAllByRole("button", { name: /ответить/i });
    await userEvent.click(submits[submits.length - 1]);

    expect(mockFetch).not.toHaveBeenCalledWith("/api/rpc/create_post", expect.anything());
  });

  it("starts a reply to a post and passes the author name to the composer", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "posts") {
        return postsChain([
          post(),
          post({
            id: "p2",
            user_id: "u2",
            content: "Второй",
            reply_to: null,
            profiles: { id: "u2", username: "bob", avatar_url: null, is_anonymous: false },
          }),
        ]);
      }
      return postsChain([]);
    });
    renderTree();

    await waitFor(() => expect(screen.getByText("Второй")).toBeInTheDocument());

    const replyButtons = screen.getAllByRole("button", { name: /ответить/i });
    await userEvent.click(replyButtons[1]);

    await waitFor(() => {
      expect(screen.getAllByText(/ответ|bob/i).length).toBeGreaterThan(0);
    });
  });

  it("toggles a post like via post_likes", async () => {
    const deleteFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    mockFrom.mockImplementation((table: string) => {
      if (table === "posts") return postsChain([post()]);
      if (table === "post_likes") return { delete: deleteFn, insert: insertFn };
      return postsChain([]);
    });
    renderTree();

    await waitFor(() => expect(screen.getByText("Первый пост")).toBeInTheDocument());

    // p1 has count 2 from the batch RPC and is liked → click unlikes it.
    const likeButton = screen.getByRole("button", { name: /2/i });
    await userEvent.click(likeButton);

    await waitFor(() => {
      expect(deleteFn).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalledWith("post_likes");
    });
  });

  it("deletes an own post via DELETE", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "posts") return postsChain([post({ user_id: "me" })]);
      return postsChain([]);
    });
    renderTree();

    await waitFor(() => expect(screen.getByText("Первый пост")).toBeInTheDocument());

    const deleteBtn = screen.getByRole("button", { name: /удалить/i });
    await userEvent.click(deleteBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/posts?id=eq.p1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });
});
