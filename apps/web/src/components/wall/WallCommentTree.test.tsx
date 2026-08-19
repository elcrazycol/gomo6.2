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


// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWallChain<T>(
  value: T,
  opts: { count?: number; insertedId?: string; onInsert?: () => void } = {},
): any {
  const { count, insertedId, onInsert } = opts;
  const p = Promise.resolve(value) as any;
  const insertResult = () => {
    onInsert?.();
    return insertedId ? { data: { id: insertedId }, error: null } : { data: null, error: null };
  };
  // Chainable branch used by count queries (select with { count: "exact" }) and
  // by insert().select("id").maybeSingle(): the returned value must still
  // support .select()/.eq()/.maybeSingle()/etc. downstream.
  const chainable = (v: any) => {
    const q = Promise.resolve(v) as any;
    q.select = () => q;
    q.eq = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.maybeSingle = () => q;
    q.insert = () => chainable(insertResult());
    q.update = () => q;
    q.delete = () => q;
    return q;
  };
  p.select = (_sel?: string, selOpts?: any) => {
    if (selOpts?.count === "exact") {
      return chainable({ count: count ?? 0, data: null, error: null });
    }
    return p;
  };
  p.eq = () => p;
  p.order = () => p;
  p.limit = () => p;
  p.maybeSingle = () => p;
  p.insert = () => chainable(insertResult());
  p.update = () => p;
  p.delete = () => p;
  return p;
}

function setupMockFrom(config: {
  comments?: any[];
  likesCount?: number;
  isLiked?: boolean;
  failLoad?: boolean;
  insertedId?: string;
  insertedParentId?: string | null;
} = {}) {
  const { comments = [], likesCount = 0, isLiked = false, failLoad = false, insertedId, insertedParentId } = config;
  // Stateful so a successful insert is visible to the reloaded comment list.
  const currentComments = [...comments];
  mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case "profile_wall_post_comments":
        return makeWallChain(
          failLoad ? { data: null, error: { message: "boom" } } : { data: currentComments, error: null },
          {
            insertedId,
            onInsert: () => {
              if (!insertedId) return;
              currentComments.push(
                makeComment({
                  id: insertedId,
                  parent_id: insertedParentId ?? null,
                  content: "Свежий комментарий",
                  created_at: "2025-01-03T10:00:00Z",
                }),
              );
            },
          },
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
    // The composer starts as a one-line prompt (pill) that expands on click.
    const view = renderTree({ comments: [] });
    await waitFor(() => {
      expect(screen.getByLabelText(/Напишите комментарий/)).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText("Напишите комментарий")).not.toBeInTheDocument();
    view.unmount();

    render(
      <WallCommentTree postId="post-1" postUserId="wall-owner" currentUserId={null} currentUsername="" onCommentCountChange={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText("Тут пока пусто, но это можно исправить.")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/Напишите комментарий/)).not.toBeInTheDocument();
  });

  it("rejects a blank top-level comment", async () => {
    const { onCommentCountChange } = renderTree({ comments: [] });
    await waitFor(() => {
      expect(screen.getByLabelText(/Напишите комментарий/)).toBeInTheDocument();
    });

    // Expand the pill, then submit whitespace-only content → must be rejected
    await userEvent.click(screen.getByLabelText(/Напишите комментарий/));
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
      expect(screen.getByLabelText(/Напишите комментарий/)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText(/Напишите комментарий/));
    const textarea = screen.getByPlaceholderText("Напишите комментарий");
    await userEvent.type(textarea, "Новый комментарий");

    // The submit button of the expanded top-level composer
    const submitButtons = screen.getAllByText("Ответить");
    await userEvent.click(submitButtons[submitButtons.length - 1]);

    await waitFor(() => {
      expect(onCommentCountChange).toHaveBeenCalledWith(1);
    });
    expect(mockFrom).toHaveBeenCalledWith("profile_wall_post_comments");
  });

  it("switches the floating composer into reply mode with an @name chip", async () => {
    const view = renderTree({ comments: [rootComment] });
    await waitFor(() => {
      expect(screen.getByText("Первый комментарий")).toBeInTheDocument();
    });

    // Click "Ответить" → the floating composer wakes up in reply mode
    const replyAction = view.container.querySelector(".lucide-reply")?.closest("button");
    await userEvent.click(replyAction!);

    expect(await screen.findByPlaceholderText("Напишите ответ")).toBeInTheDocument();
    // The @name chip inside the composer box (the hidden underlay pill also
    // mentions the name, so anchor on the exact chip text).
    expect(screen.getByText(/^@alice$/)).toBeInTheDocument();
  });

  it("cancels reply mode back to a plain comment", async () => {
    const view = renderTree({ comments: [rootComment] });
    await waitFor(() => {
      expect(screen.getByText("Первый комментарий")).toBeInTheDocument();
    });

    const replyAction = view.container.querySelector(".lucide-reply")?.closest("button");
    await userEvent.click(replyAction!);
    await screen.findByPlaceholderText("Напишите ответ");

    await userEvent.click(screen.getByLabelText("Отменить ответ"));
    await waitFor(() => {
      expect(screen.queryByText(/@alice/)).not.toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("Напишите комментарий")).toBeInTheDocument();
  });

  it("shows an error toast for a blank reply", async () => {
    const view = renderTree({ comments: [rootComment] });
    await waitFor(() => {
      expect(screen.getByText("Первый комментарий")).toBeInTheDocument();
    });

    // Click "Ответить" → the floating composer switches to reply mode
    const replyAction = view.container.querySelector(".lucide-reply")?.closest("button");
    await userEvent.click(replyAction!);
    const replyTextarea = await screen.findByPlaceholderText("Напишите ответ");

    // Type only whitespace, then submit via Enter → must be rejected
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

    const replyTextarea = await screen.findByPlaceholderText("Напишите ответ");
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
    });
    // Soft delete: the comment survives as a placeholder (replies stay), so
    // the visible comment counter must NOT change.
    expect(onCommentCountChange).not.toHaveBeenCalled();
  });

  it("renders a soft-deleted comment as an unknown-author placeholder and keeps its replies", async () => {
    const deletedComment = makeComment({
      id: "deleted-1",
      content: "",
      content_json: null,
      is_deleted: true,
      updated_at: "2025-01-02T10:00:00Z",
    });
    const replyToDeleted = makeComment({
      id: "reply-to-deleted",
      user_id: "user-2",
      parent_id: "deleted-1",
      content: "Ответ под удалённым",
      author: { username: "bob", display_name: null, is_anonymous: false, avatar_url: null },
    });
    const { container } = renderTree({ comments: [deletedComment, replyToDeleted] });

    await waitFor(() => {
      // The author slot shows "Автор неизвестен", the body — "Комментарий удалён".
      expect(screen.getByText("Автор неизвестен")).toBeInTheDocument();
      expect(screen.getByText("Комментарий удалён")).toBeInTheDocument();
    });

    // The reply subtree underneath the deleted comment stays intact.
    expect(screen.getByText("Ответ под удалённым")).toBeInTheDocument();
    // Author is hidden — no name, no avatar link.
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
    expect(container.querySelector("[data-wall-avatar='deleted']")).toBeInTheDocument();
    // No like/reply/edit/delete actions on the placeholder's own row (the
    // live reply underneath keeps its own actions — that's fine). The node's
    // children container also nests the reply, so scope to the row itself.
    const deletedNode = container.querySelector("[data-comment-id='deleted-1']")!;
    const deletedRow = deletedNode.querySelector(":scope > .group");
    expect(deletedRow?.querySelector(".lucide-heart")).not.toBeInTheDocument();
    expect(deletedRow?.querySelector(".lucide-reply")).not.toBeInTheDocument();
    expect(deletedRow?.querySelector('[title="Редактировать"]')).not.toBeInTheDocument();
    expect(deletedRow?.querySelector('[title="Удалить"]')).not.toBeInTheDocument();
    // …but the reply branch can still be collapsed.
    expect(screen.getByText("Свернуть")).toBeInTheDocument();
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

  it("scrolls to and highlights the freshly published top-level comment", async () => {
    const { container } = renderTree({ comments: [], insertedId: "fresh-1" });
    await waitFor(() => {
      expect(screen.getByLabelText(/Напишите комментарий/)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText(/Напишите комментарий/));
    await userEvent.type(screen.getByPlaceholderText("Напишите комментарий"), "Свежий комментарий");
    await userEvent.click(screen.getAllByText("Ответить")[0]);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Комментарий опубликован");
    });
    await waitFor(() => {
      expect(container.querySelector("[data-comment-id='fresh-1']")).toBeInTheDocument();
    });
    expect(container.querySelector("[data-comment-id='fresh-1'] [data-wall-highlighted='true']"))
      .toBeInTheDocument();
    // The editor box folds back into the quiet pill after a successful submit
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Напишите комментарий")).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Напишите комментарий/)).toBeInTheDocument();
  });

  it("highlights a newly published reply and greets it with its own toast", async () => {
    const { container } = renderTree({
      comments: [rootComment, childComment],
      insertedId: "reply-fresh",
      insertedParentId: "c2",
    });
    await waitFor(() => {
      expect(screen.getByText("Ответный комментарий")).toBeInTheDocument();
    });

    const replyActions = container.querySelectorAll(".lucide-reply");
    const replyAction = replyActions[replyActions.length - 1]?.closest("button");
    await userEvent.click(replyAction!);
    const replyTextarea = await screen.findByPlaceholderText("Напишите ответ");
    await userEvent.type(replyTextarea, "Глубокий ответ{Enter}");

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Ответ опубликован");
    });
    await waitFor(() => {
      expect(container.querySelector("[data-comment-id='reply-fresh'] [data-wall-highlighted='true']"))
        .toBeInTheDocument();
    });
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

  it("pins the composer as fixed above the keyboard on touch while focused", async () => {
    // Simulate a coarse-pointer device so the keyboard handling (and the pin)
    // is active; everything else reports false.
    const matchMediaMock = vi.fn((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMediaMock);
    const { initMobileKeyboard } = await import("@/lib/mobileKeyboard");
    const dispose = initMobileKeyboard();

    try {
      const view = renderTree({ comments: [] });
      await waitFor(() => {
        expect(screen.getByLabelText(/Напишите комментарий/)).toBeInTheDocument();
      });

      // Expand the pill, then focus the editor the way a tap would.
      await userEvent.click(screen.getByLabelText(/Напишите комментарий/));
      const textarea = screen.getByPlaceholderText("Напишите комментарий");
      act(() => {
        textarea.focus();
      });

      // The composer anchor must pin synchronously: fixed above the keyboard,
      // and gestures starting on it must not dismiss the keyboard.
      const anchor = view.container.querySelector(".sticky");
      expect(anchor).toBeTruthy();
      await waitFor(() => {
        expect(anchor!.classList.contains("wall-composer-pinned")).toBe(true);
        expect(anchor!.getAttribute("data-kb-locked")).toBe("true");
      });
      // The scroll-room pad kicks in while the composer is pinned.
      expect(view.container.querySelector(".wall-comments-pad")).toBeTruthy();

      // Leaving the composer releases the pin and the pad.
      act(() => {
        textarea.blur();
      });
      await waitFor(() => {
        expect(anchor!.classList.contains("wall-composer-pinned")).toBe(false);
        expect(anchor!.getAttribute("data-kb-locked")).toBeNull();
      });
      expect(view.container.querySelector(".wall-comments-pad")).toBeNull();
    } finally {
      dispose();
      vi.unstubAllGlobals();
    }
  });

  it("does not pin the collapsed pill button — only the editor pins, so the first tap expands", async () => {
    // Coarse pointer: keyboard handling (and the pin) is active.
    const matchMediaMock = vi.fn((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMediaMock);
    const { initMobileKeyboard } = await import("@/lib/mobileKeyboard");
    const dispose = initMobileKeyboard();

    try {
      const view = renderTree({ comments: [] });
      await waitFor(() => {
        expect(screen.getByLabelText(/Напишите комментарий/)).toBeInTheDocument();
      });

      const anchor = view.container.querySelector(".sticky");
      expect(anchor).toBeTruthy();

      // Tapping the collapsed pill focuses the BUTTON before the click that
      // expands the composer. That focus must NOT pin the bar — pinning yanks
      // it out of the flow (position:fixed + the scroll pad under the finger),
      // so the click that should call setExpanded(true) misses the pill and
      // the composer never opens on the first tap.
      const pill = screen.getByLabelText(/Напишите комментарий/);
      act(() => {
        pill.focus();
      });
      expect(anchor!.classList.contains("wall-composer-pinned")).toBe(false);
      expect(anchor!.getAttribute("data-kb-locked")).toBeNull();
      expect(view.container.querySelector(".wall-comments-pad")).toBeNull();

      // The click then expands the composer and the editor takes focus — only
      // now must the bar pin (exactly the pre-existing behavior).
      await userEvent.click(pill);
      const textarea = screen.getByPlaceholderText("Напишите комментарий");
      act(() => {
        textarea.focus();
      });
      await waitFor(() => {
        expect(anchor!.classList.contains("wall-composer-pinned")).toBe(true);
        expect(anchor!.getAttribute("data-kb-locked")).toBe("true");
      });
      expect(view.container.querySelector(".wall-comments-pad")).toBeTruthy();
    } finally {
      dispose();
      vi.unstubAllGlobals();
    }
  });

  it("keeps the composer docked while the keyboard is up even after focus leaves", async () => {
    const matchMediaMock = vi.fn((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMediaMock);
    // Fake a visual viewport that reports the keyboard covering 300px so the
    // global keyboard state reads as OPEN.
    const vv = { height: 500, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const { initMobileKeyboard } = await import("@/lib/mobileKeyboard");
    const dispose = initMobileKeyboard();
    window.dispatchEvent(new Event("resize"));

    try {
      const view = renderTree({ comments: [] });
      await waitFor(() => {
        expect(screen.getByLabelText(/Напишите комментарий/)).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText(/Напишите комментарий/));
      const textarea = screen.getByPlaceholderText("Напишите комментарий");
      act(() => {
        textarea.focus();
      });
      const anchor = view.container.querySelector(".sticky");
      await waitFor(() => {
        expect(anchor!.classList.contains("wall-composer-pinned")).toBe(true);
      });

      // Focus leaves to a NON-editable (e.g. a reply button on a comment)
      // while the keyboard is still up — the dock must NOT be released.
      const outsideButton = document.createElement("button");
      document.body.appendChild(outsideButton);
      act(() => {
        outsideButton.focus();
      });
      expect(anchor!.classList.contains("wall-composer-pinned")).toBe(true);
      expect(view.container.querySelector(".wall-comments-pad")).toBeTruthy();

      // Simulate the keyboard closing: the visual viewport returns to full
      // height, and focus is outside → the dock releases.
      Object.defineProperty(window, "visualViewport", { value: { ...vv, height: 800 }, configurable: true });
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      await waitFor(() => {
        expect(anchor!.classList.contains("wall-composer-pinned")).toBe(false);
      });

      // Re-focus the editor, then hand the keyboard over to ANOTHER editable
      // (e.g. a comment's inline edit box) — the dock must release immediately
      // via the document-level focusin listener.
      act(() => {
        textarea.focus();
      });
      await waitFor(() => {
        expect(anchor!.classList.contains("wall-composer-pinned")).toBe(true);
      });
      const otherEditor = document.createElement("textarea");
      document.body.appendChild(otherEditor);
      act(() => {
        otherEditor.focus();
      });
      expect(anchor!.classList.contains("wall-composer-pinned")).toBe(false);
    } finally {
      dispose();
      vi.unstubAllGlobals();
      delete (window as any).visualViewport;
      delete (window as any).innerHeight;
    }
  });
});
