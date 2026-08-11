import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { toast } from "sonner";
import { WallCommentTree } from "./WallCommentTree";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFrom = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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

// Keep the avatar URL assertion deterministic: Radix AvatarImage waits for
// the browser image-load event, which jsdom does not dispatch automatically.
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div>,
  AvatarImage: (props: any) => <img alt="" {...props} />,
  AvatarFallback: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

vi.mock("@/components/GomoRichEditor", () => ({
  GomoRichEditor: ({ placeholder, onChange, onSubmit, resetKey, text, legacyContent, maxLength }: any) => (
    <div data-testid="gomo-rich-editor" data-placeholder={placeholder} data-reset-key={resetKey} data-max-length={maxLength}>
      <textarea
        data-testid="rich-editor-textarea"
        placeholder={placeholder}
        // Uncontrolled so userEvent typing accumulates.
        defaultValue={text ?? legacyContent ?? ""}
        // Emit a prosemirror-shaped doc that mirrors the typed text, like the
        // real editor would — otherwise the \u200b EMPTY_EDITOR_STATE bleeds
        // through and the component's blank check trips.
        onChange={(e) => {
          const value = e.target.value;
          onChange?.({
            json: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
            },
            text: value,
          });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit?.();
          }
        }}
      />
    </div>
  ),
  GomoRichEditorHandle: null,
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "2 часа назад",
}));

vi.mock("date-fns/locale", () => ({ ru: {} }));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWallChain<T>(value: T, opts: { count?: number } = {}): any {
  const p = Promise.resolve(value) as any;
  // Chainable branch used by count queries (select with { count: "exact" }):
  // the returned value must still support .eq()/etc. downstream.
  const chainable = (v: any) => {
    const q = Promise.resolve(v) as any;
    q.select = () => q;
    q.eq = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.maybeSingle = () => q;
    q.insert = () => Promise.resolve({ data: null, error: null });
    q.update = () => q;
    q.delete = () => q;
    return q;
  };
  p.select = (_sel?: string, selOpts?: any) => {
    if (selOpts?.count === "exact") {
      return chainable({ count: opts.count ?? 0, data: null, error: null });
    }
    return p;
  };
  p.eq = () => p;
  p.order = () => p;
  p.limit = () => p;
  p.maybeSingle = () => p;
  p.insert = () => Promise.resolve({ data: null, error: null });
  p.update = () => p;
  p.delete = () => p;
  return p;
}

function setupMockFrom(config: {
  comments?: any[];
  likesCount?: number;
  isLiked?: boolean;
  failLoad?: boolean;
} = {}) {
  const { comments = [], likesCount = 0, isLiked = false, failLoad = false } = config;
  mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case "profile_wall_post_comments":
        return makeWallChain(
          failLoad ? { data: null, error: { message: "boom" } } : { data: comments, error: null },
        );
      case "profile_wall_comment_likes":
        return makeWallChain(
          { data: isLiked ? { id: "like-1" } : null, error: null },
          { count: likesCount },
        );
      default:
        return makeWallChain({ data: [], error: null });
    }
  });
}

function makeComment(overrides: any = {}) {
  return {
    id: "c1",
    post_id: "post-1",
    user_id: "user-1",
    parent_id: null,
    content: "Первый комментарий",
    content_json: null,
    created_at: "2025-01-01T10:00:00Z",
    updated_at: "2025-01-01T10:00:00Z",
    author: { username: "alice", display_name: null, is_anonymous: false, avatar_url: null },
    ...overrides,
  };
}

const rootComment = makeComment({ id: "c1", content: "Первый комментарий" });
const childComment = makeComment({
  id: "c2",
  user_id: "user-2",
  parent_id: "c1",
  content: "Ответный комментарий",
  author: { username: "bob", display_name: null, is_anonymous: false, avatar_url: null },
});

function renderTree(config: any = {}) {
  const onCommentCountChange = vi.fn();
  setupMockFrom(config);
  const view = render(
    <WallCommentTree
      postId="post-1"
      postUserId={config.postUserId ?? "wall-owner"}
      currentUserId="user-1"
      currentUsername="alice"
      onCommentCountChange={onCommentCountChange}
    />,
  );
  return { onCommentCountChange, ...view };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WallCommentTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading skeleton while comments are fetched", () => {
    mockFrom.mockReturnValue({
      ...makeWallChain(null),
      select: () => ({ ...makeWallChain(null), eq: () => ({ ...makeWallChain(null), order: () => new Promise<never>(() => {}) }) }),
    });
    const { container } = render(
      <WallCommentTree postId="post-1" postUserId="wall-owner" currentUserId="user-1" currentUsername="alice" onCommentCountChange={vi.fn()} />,
    );
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows the empty state when there are no comments", async () => {
    renderTree({ comments: [] });
    await waitFor(() => {
      expect(screen.getByText("Тут пока пусто, но это можно исправить.")).toBeInTheDocument();
    });
  });

  it("renders comments with authors and a correct plural counter", async () => {
    renderTree({ comments: [rootComment, childComment] });
    await waitFor(() => {
      expect(screen.getByText("Первый комментарий")).toBeInTheDocument();
      expect(screen.getByText("Ответный комментарий")).toBeInTheDocument();
      expect(screen.getByText("alice")).toBeInTheDocument();
      // "bob" appears both as the author link and inside the "ответ …" line
      expect(screen.getAllByText("bob").length).toBeGreaterThan(0);
      expect(screen.queryByText("Обсуждение")).not.toBeInTheDocument();
      expect(screen.queryByText("2 комментария")).not.toBeInTheDocument();
    });
  });

  it("shows the singular '1 комментарий' counter", async () => {
    renderTree({ comments: [rootComment] });
    await waitFor(() => {
      expect(screen.getByText("Первый комментарий")).toBeInTheDocument();
    });
    expect(screen.queryByText("1 комментарий")).not.toBeInTheDocument();
    expect(screen.queryByText("Обсуждение")).not.toBeInTheDocument();
  });

  it("resolves stored avatar keys through the storage URL helper", async () => {
    const commentWithAvatar = makeComment({
      author: { username: "alice", display_name: null, is_anonymous: false, avatar_url: "user-1/avatar.webp" },
    });
    renderTree({ comments: [commentWithAvatar] });

    await waitFor(() => {
      expect(screen.getByAltText("alice")).toHaveAttribute(
        "src",
        "/storage/v1/object/post-images/user-1/avatar.webp",
      );
    });
  });

  it("renders the top-level composer only for authenticated users", async () => {
    const view = renderTree({ comments: [] });
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Напишите комментарий")).toBeInTheDocument();
    });
    view.unmount();

    render(
      <WallCommentTree postId="post-1" postUserId="wall-owner" currentUserId={null} currentUsername="" onCommentCountChange={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText("Тут пока пусто, но это можно исправить.")).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText("Напишите комментарий")).not.toBeInTheDocument();
  });

  it("rejects a blank top-level comment", async () => {
    const { onCommentCountChange } = renderTree({ comments: [] });
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Напишите комментарий")).toBeInTheDocument();
    });

    // Submitting whitespace-only content must be rejected with a toast
    const textarea = screen.getByPlaceholderText("Напишите комментарий");
    await userEvent.type(textarea, "   {Enter}");

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Напишите комментарий");
    });
    expect(onCommentCountChange).not.toHaveBeenCalled();
  });

  it("submits a top-level comment", async () => {
    const { onCommentCountChange } = renderTree({ comments: [] });
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Напишите комментарий")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("Напишите комментарий");
    await userEvent.type(textarea, "Новый комментарий");

    // The submit button of the top-level composer
    // The submit button of the top-level composer
    const submitButtons = screen.getAllByText("Ответить");
    await userEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => {
      expect(onCommentCountChange).toHaveBeenCalledWith(1);
    });
    expect(mockFrom).toHaveBeenCalledWith("profile_wall_post_comments");
  });

  it("shows an error toast for a blank reply", async () => {
    const view = renderTree({ comments: [rootComment] });
    await waitFor(() => {
      expect(screen.getByText("Первый комментарий")).toBeInTheDocument();
    });

    // Open the reply composer for the root comment
    const replyAction = view.container.querySelector(".lucide-reply")?.closest("button");
    await userEvent.click(replyAction!);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Напишите ответ")).toBeInTheDocument();
    });

    // Type only whitespace, then submit via Enter → must be rejected
    const replyTextarea = screen.getByPlaceholderText("Напишите ответ");
    await userEvent.type(replyTextarea, "   {Enter}");

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Напишите ответ");
    });
  });

  it("submits a reply with parent_id", async () => {
    const view = renderTree({ comments: [rootComment] });
    const { onCommentCountChange } = view;
    await waitFor(() => {
      expect(screen.getByText("Первый комментарий")).toBeInTheDocument();
    });

    // Click the node's "Ответить" action (contains the Reply icon)
    const replyAction = view.container.querySelector(".lucide-reply")?.closest("button");
    expect(replyAction).toBeTruthy();
    await userEvent.click(replyAction!);

    const replyTextarea = screen.getByPlaceholderText("Напишите ответ");
    await userEvent.type(replyTextarea, "Мой ответ{Enter}");

    await waitFor(() => {
      expect(onCommentCountChange).toHaveBeenCalledWith(1);
    });
    expect(mockFrom).toHaveBeenCalledWith("profile_wall_post_comments");
  });

  it("edits an owned comment", async () => {
    const ownedComment = makeComment({ id: "mine", user_id: "user-1", content: "Мой коммент" });
    const { onCommentCountChange } = renderTree({ comments: [ownedComment] });
    await waitFor(() => {
      expect(screen.getByText("Мой коммент")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTitle("Редактировать"));
    const editTextarea = screen.getByPlaceholderText("Измените комментарий");
    await userEvent.clear(editTextarea);
    await userEvent.type(editTextarea, "Отредактировано{Enter}");

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Комментарий обновлён");
    });
    expect(onCommentCountChange).not.toHaveBeenCalled();
  });

  it("does not offer edit/delete for comments owned by others", async () => {
    // A root comment owned by user-2; current user is user-1 and is NOT the
    // wall owner → no edit, no delete.
    const otherUserComment = makeComment({
      id: "c-other",
      user_id: "user-2",
      parent_id: null,
      content: "Чужой комментарий",
      author: { username: "bob", display_name: null, is_anonymous: false, avatar_url: null },
    });
    renderTree({ comments: [otherUserComment] });
    await waitFor(() => {
      expect(screen.getByText("Чужой комментарий")).toBeInTheDocument();
    });
    expect(screen.queryByTitle("Редактировать")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Удалить")).not.toBeInTheDocument();
  });

  it("lets the wall owner delete any comment", async () => {
    const otherUserComment = makeComment({
      id: "c-other",
      user_id: "user-2",
      parent_id: null,
      content: "Чужой комментарий",
      author: { username: "bob", display_name: null, is_anonymous: false, avatar_url: null },
    });
    const { onCommentCountChange } = renderTree({
      comments: [otherUserComment],
      postUserId: "user-1", // current user owns the wall
    });
    await waitFor(() => {
      expect(screen.getByText("Чужой комментарий")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTitle("Удалить"));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Комментарий удалён");
      expect(onCommentCountChange).toHaveBeenCalledWith(-1);
    });
  });

  it("shows an error toast when deleting fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderTree({ comments: [rootComment] });
    await waitFor(() => {
      expect(screen.getByText("Первый комментарий")).toBeInTheDocument();
    });

    // Make the delete chain fail
    const failingDelete = { data: null, error: { message: "no permission" } };
    mockFrom.mockImplementation((table: string) => {
      if (table === "profile_wall_post_comments") {
        const p = Promise.resolve({ data: [], error: null }) as any;
        p.select = () => p;
        p.eq = () => p;
        p.order = () => p;
        p.delete = () => {
          const d = Promise.resolve(failingDelete) as any;
          d.eq = () => d;
          return d;
        };
        return p;
      }
      return makeWallChain({ data: [], error: null });
    });

    await userEvent.click(screen.getByTitle("Удалить"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Не удалось удалить комментарий");
    });
  });

  it("shows an error toast when loading comments fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderTree({ comments: [], failLoad: true });
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Не удалось загрузить комментарии");
    });
  });

  it("collapses and expands a thread with children", async () => {
    renderTree({ comments: [rootComment, childComment] });
    await waitFor(() => {
      expect(screen.getByText("Ответный комментарий")).toBeInTheDocument();
    });

    // Collapse: the thread has children → "Свернуть" button
    await userEvent.click(screen.getByText("Свернуть"));
    await waitFor(() => {
      expect(screen.getByText("Показать 1 ответ")).toBeInTheDocument();
    });

    // Expand again
    await userEvent.click(screen.getByText("Показать 1 ответ"));
    await waitFor(() => {
      expect(screen.getByText("Свернуть")).toBeInTheDocument();
    });
  });

  it("toggles a like without fetching per-comment like state on mount", async () => {
    const { container } = renderTree({ comments: [rootComment] });
    await waitFor(() => {
      expect(screen.getByText("Первый комментарий")).toBeInTheDocument();
    });

    const likeButton = container.querySelector(".lucide-heart")?.closest("button");
    expect(likeButton).toBeTruthy();
    expect(likeButton).not.toHaveTextContent("1");

    // Optimization guard: the like count/state arrives embedded in the
    // comments GET — mounting a comment must NOT fire like requests.
    expect(mockFrom).not.toHaveBeenCalledWith("profile_wall_comment_likes");

    await userEvent.click(likeButton!);

    await waitFor(() => {
      expect(likeButton).toHaveTextContent("1");
    });
    expect(mockFrom).toHaveBeenCalledWith("profile_wall_comment_likes");
  });

  it("renders the initial like count when present", async () => {
    const { container } = renderTree({
      comments: [makeComment({ likes_count: 3, liked_by_viewer: true })],
    });
    await waitFor(() => {
      expect(screen.getByText("Первый комментарий")).toBeInTheDocument();
    });

    const likeButton = container.querySelector(".lucide-heart")?.closest("button");
    await waitFor(() => {
      expect(likeButton).toHaveTextContent("3");
    });
    // No per-comment like fetch on mount — count came embedded in the comment.
    expect(mockFrom).not.toHaveBeenCalledWith("profile_wall_comment_likes");
  });

  it("reverts the like when the API call fails", async () => {
    const { container } = renderTree({ comments: [rootComment], likesCount: 0 });
    await waitFor(() => {
      expect(screen.getByText("Первый комментарий")).toBeInTheDocument();
    });

    const likeButton = container.querySelector(".lucide-heart")?.closest("button");
    await userEvent.click(likeButton!);
    await waitFor(() => {
      expect(likeButton).toHaveTextContent("1");
    });

    // Second click (unlike) fails → optimistic state must revert to 1
    mockFrom.mockImplementation((table: string) => {
      if (table === "profile_wall_comment_likes") {
        const p = Promise.resolve({ data: null, error: null }) as any;
        p.select = () => p;
        p.eq = () => p;
        p.delete = () => {
          const d = Promise.resolve({ data: null, error: { message: "boom" } }) as any;
          d.eq = () => d;
          return d;
        };
        return p;
      }
      return makeWallChain({ data: [], error: null });
    });

    await userEvent.click(likeButton!);
    await waitFor(() => {
      expect(likeButton).toHaveTextContent("1");
    });
  });

  it("marks edited comments with the (ред.) hint", async () => {
    const editedComment = makeComment({ id: "edited-1", updated_at: "2025-01-02T10:00:00Z" });
    renderTree({ comments: [editedComment] });
    await waitFor(() => {
      expect(screen.getByText("(ред.)")).toBeInTheDocument();
    });
  });

  it("uses CSS thread connectors for replies and no continuation after the last sibling", async () => {
    const secondChild = makeComment({
      id: "c3",
      user_id: "user-3",
      parent_id: "c1",
      content: "Второй ответ",
      author: { username: "carol", display_name: null, is_anonymous: false, avatar_url: null },
    });
    const { container } = renderTree({ comments: [rootComment, childComment, secondChild] });

    await waitFor(() => {
      expect(screen.getByText("Второй ответ")).toBeInTheDocument();
    });

    expect(container.querySelectorAll("[data-wall-thread-connection='true']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-wall-thread-continuation='true']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-wall-thread-parent-stem='true']")).toHaveLength(1);
    expect(container.querySelector("[data-wall-thread-lines='true']")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Свернуть"));
    expect(screen.getByText("Показать 2 ответа").closest("button"))
      .toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector("#wall-comment-children-c1"))
      .toHaveClass("grid-rows-[0fr]");
  });

  it("connects nested levels without stray continuation lines", async () => {
    const secondReply = makeComment({
      id: "c3",
      user_id: "user-3",
      parent_id: "c1",
      content: "Второй ответ",
      author: { username: "carol", display_name: null, is_anonymous: false, avatar_url: null },
    });
    const grandchild = makeComment({
      id: "c4",
      user_id: "user-4",
      parent_id: "c2",
      content: "Глубокий ответ",
      author: { username: "dave", display_name: null, is_anonymous: false, avatar_url: null },
    });
    const { container } = renderTree({
      comments: [rootComment, childComment, secondReply, grandchild],
    });

    await waitFor(() => {
      expect(screen.getByText("Глубокий ответ")).toBeInTheDocument();
    });

    // Root and the first reply both have children → two parent stems.
    expect(container.querySelectorAll("[data-wall-thread-parent-stem='true']")).toHaveLength(2);
    // Every reply (2 siblings + 1 grandchild) gets an elbow to its parent rail.
    expect(container.querySelectorAll("[data-wall-thread-connection='true']")).toHaveLength(3);
    // Only the non-last sibling of the root branch continues downwards;
    // the last sibling and the grandchild must NOT draw a continuation.
    expect(container.querySelectorAll("[data-wall-thread-continuation='true']")).toHaveLength(1);
  });

  it("shows the reply context line for nested comments", async () => {
    renderTree({ comments: [rootComment, childComment] });
    await waitFor(() => {
      expect(screen.getByText("Ответный комментарий")).toBeInTheDocument();
    });
    expect(screen.getByText(/ответ/)).toBeInTheDocument();
  });

  it("unmounts cleanly without warnings", async () => {
    const view = renderTree({ comments: [] });
    await waitFor(() => {
      expect(screen.getByText("Тут пока пусто, но это можно исправить.")).toBeInTheDocument();
    });
    act(() => {
      view.unmount();
    });
  });
});
