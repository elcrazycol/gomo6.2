import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from "vitest";
import { toast } from "sonner";
import { shouldScrollToComments, smoothScrollToElement } from "@/utils/smoothScroll";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockWsService = {
  subscribe: vi.fn(),
  on: vi.fn<any, any>(),
};

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
    rpc: (...args: any[]) => mockRpc(...args),
  },
}));

vi.mock("@/services/websocket", () => ({
  wsService: mockWsService,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// The share sheet has its own dedicated tests; here it is stubbed so the
// wall-post card test asserts the button wires it up without pulling in the
// messenger store / network.
vi.mock("@/components/share/ShareSheet", () => ({
  ShareSheet: ({ open }: any) => (open ? <div data-testid="share-sheet" /> : null),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/profile/wall-owner", search: "", hash: "", state: null, key: "default" }),
  Link: ({ children, to, className, onClick }: any) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/GomoRichEditor", () => ({
  GomoRichEditor: ({ placeholder, onChange, onSubmit, resetKey, contentJson, legacyContent }: any) => (
    <div data-testid="gomo-rich-editor" data-placeholder={placeholder} data-reset-key={resetKey}>
      <textarea
        data-testid="rich-editor-textarea"
        placeholder={placeholder}
        value={legacyContent || ""}
        onChange={(e) => onChange?.({ json: contentJson || {}, text: e.target.value })}
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

vi.mock("@/components/CreateWallPost", () => ({
  CreateWallPost: ({ profileUserId, currentUserId, editingPost, onPostCreated, onPostUpdated, onCancel, onBeforeCreate }: any) => (
    <div data-testid="create-wall-post" data-profile-user-id={profileUserId} data-current-user-id={currentUserId} data-editing={!!editingPost}>
      <button data-testid="mock-submit-post" onClick={() => {
        onBeforeCreate?.();
        onPostCreated?.({
          id: crypto.randomUUID(),
          user_id: profileUserId,
          author_id: currentUserId,
          title: "Test post",
          content: "Test content",
          content_json: null,
          image_url: null,
          attachments: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_pinned: false,
          author: { username: "testuser", is_anonymous: false, avatar_url: null },
        });
      }}>
        {editingPost ? "Save Edit" : "Create Post"}
      </button>
      <button data-testid="mock-cancel" onClick={onCancel}>Cancel</button>
    </div>
  ),
  WallPost: null as any,
}));

vi.mock("@/components/ProcessedContent", () => ({
  ProcessedContent: ({ content }: any) => <span data-testid="processed-content">{content}</span>,
}));

vi.mock("@/components/UserBadge", () => ({
  UserBadge: ({ username }: any) => <span data-testid="user-badge">{username}</span>,
}));

vi.mock("@/components/Lightbox", () => ({
  Lightbox: ({ items, initialIndex, onClose }: any) => (
    <div data-testid="image-gallery" data-images={items?.length} data-index={initialIndex}>
      <button data-testid="gallery-close" onClick={onClose}>Close Gallery</button>
    </div>
  ),
}));

vi.mock("@/components/MediaPlayer", () => ({
  MediaPlayer: ({ kind, sources }: any) => <div data-testid="media-player" data-kind={kind} data-src={sources?.[0]?.src}>Media</div>,
}));

vi.mock("@/components/AudioAttachment", () => ({
  AudioAttachment: ({ attachment }: any) => <div data-testid="audio-attachment">Audio: {attachment.name}</div>,
}));

vi.mock("@/utils/smoothScroll", () => ({
  smoothScrollToElement: vi.fn(),
  shouldScrollToComments: vi.fn(() => false),
  COMMENTS_TARGET_FRACTION: 0.35,
}));

// ─── Query Builder Mocks ─────────────────────────────────────────────────────

/**
 * Creates an infinitely chainable mock for PostgREST-style query chains.
 *
 * Supports:
 *   .select().eq().order().order().order().in().maybeSingle().single()
 *   .insert().select().single()
 *   .update().eq()
 *   .delete().eq().eq().or()
 *
 * When awaited, resolves to { data, error }.
 */
function makeChain<T>(resolveValue: T): any {
  const p = Promise.resolve(resolveValue) as any;

  p.select = (_sel?: string, _opts?: any) => p;
  p.eq = (_col?: string, _val?: any) => p;
  p.order = (_col?: string, _opts?: any) => p;
  p.in = (_col?: string, _vals?: any[]) => p;
  p.limit = (_n?: number) => p;
  p.or = (_filter?: string) => p;
  p.single = () => p;
  p.maybeSingle = () => p;

  // insert returns a chain so that .insert({...}).select().single() works
  // Returns { data: { id: ... }, error: null } — a single object, not array
  p.insert = (_row?: any) => {
    const insertResult = { data: { id: "new-id" }, error: null };
    const insertP = Promise.resolve(insertResult) as any;
    insertP.select = () => insertP;
    insertP.single = () => insertP;
    return insertP;
  };

  // update returns a chain so that .update({...}).eq().eq() works
  p.update = (_row?: any) => {
    const updateResult = { data: null, error: null };
    const updateP = Promise.resolve(updateResult) as any;
    updateP.eq = () => updateP;
    updateP.or = () => updateP;
    updateP.select = () => updateP;
    return updateP;
  };

  // delete returns a chain so that .delete().eq().eq().or() works
  p.delete = () => {
    const deleteResult = { data: null, error: null };
    const delP = Promise.resolve(deleteResult) as any;
    delP.eq = () => delP;
    delP.or = () => delP;
    delP.select = () => delP;
    return delP;
  };

  return p;
}

/**
 * Configures mockFrom for the given tables.
 *
 * The count/filter queries (likes, comments, reposts counts + user state)
 * return appropriate data structures the component expects.
 */
function setupApiMocks(config: {
  posts?: any[];
  comments?: any[];
  likesCount?: number;
  commentsCount?: number;
  repostsCount?: number;
  isLiked?: boolean;
  isReposted?: boolean;
  repostRecordId?: string | null;
  repostedWallPostId?: string | null;
} = {}) {
  const {
    posts = [createMockPost()],
    comments = [createMockComment()],
    likesCount = 0,
    commentsCount = 0,
    repostsCount = 0,
    isLiked = false,
    isReposted = false,
    repostRecordId = null,
    repostedWallPostId = null,
  } = config;

  mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case "profile_wall_posts":
        return makeChain({ data: posts, error: null });

      case "profile_wall_post_comments":
        return makeChain({ data: comments, error: null });

      case "profile_wall_post_likes":
        // Likes count vs. user-state queries share this table
        return makeChain({ data: isLiked ? { id: "like-1" } : null, error: null });

      case "profile_wall_post_reposts":
        return makeChain({
          data: isReposted
            ? { id: repostRecordId || "repost-1", reposted_wall_post_id: repostedWallPostId }
            : null,
          error: null,
        });

      default:
        return makeChain({ data: [], error: null });
    }
  });

  mockRpc.mockResolvedValue({ data: true, error: null });
}

/**
 * Same as setupApiMocks but for tests where the count query is separate
 * from the user-state query (makes likesChain / repostsChain smarter).
 */
function setupApiMocksWithCounts(config: {
  posts?: any[];
  comments?: any[];
  likesCount?: number;
  commentsCount?: number;
  repostsCount?: number;
  isLiked?: boolean;
  isReposted?: boolean;
  repostRecordId?: string | null;
  repostedWallPostId?: string | null;
} = {}) {
  const {
    posts = [createMockPost()],
    comments = [createMockComment()],
    likesCount = 0,
    commentsCount = 0,
    repostsCount = 0,
    isLiked = false,
    isReposted = false,
    repostRecordId = null,
    repostedWallPostId = null,
  } = config;

  mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case "profile_wall_posts":
        return makeChain({ data: posts, error: null });

      case "profile_wall_post_comments": {
        const chain = makeChain({ data: comments, error: null });
        // When count is queried, return count
        const origSelect = chain.select;
        chain.select = (sel: string, opts?: any) => {
          if (opts?.count === "exact") {
            return makeChain({ count: commentsCount, data: null, error: null });
          }
          return origSelect(sel, opts);
        };
        return chain;
      }

      case "profile_wall_post_likes": {
        const chain = makeChain({ data: isLiked ? { id: "like-1" } : null, error: null });
        const origSelect = chain.select;
        chain.select = (sel: string, opts?: any) => {
          if (opts?.count === "exact") {
            return makeChain({ count: likesCount, data: null, error: null });
          }
          return origSelect(sel, opts);
        };
        return chain;
      }

      case "profile_wall_post_reposts": {
        const chain = makeChain({
          data: isReposted
            ? { id: repostRecordId || "repost-1", reposted_wall_post_id: repostedWallPostId }
            : null,
          error: null,
        });
        const origSelect = chain.select;
        chain.select = (sel: string, opts?: any) => {
          if (opts?.count === "exact") {
            return makeChain({ count: repostsCount, data: null, error: null });
          }
          return origSelect(sel, opts);
        };
        return chain;
      }

      default:
        return makeChain({ data: [], error: null });
    }
  });

  mockRpc.mockResolvedValue({ data: true, error: null });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockPost(overrides: any = {}) {
  return {
    id: "post-1",
    user_id: "profile-user-1",
    author_id: "author-1",
    title: "Test post",
    content: "Hello wall!",
    content_json: null,
    image_url: null,
    attachments: null,
    repost_of_post_id: null,
    original_post: null,
    created_at: "2025-01-15T10:00:00Z",
    updated_at: "2025-01-15T10:00:00Z",
    is_pinned: false,
    pinned_order: null,
    author: { username: "testuser", is_anonymous: false, avatar_url: null },
    ...overrides,
  };
}

function createMockComment(overrides: any = {}) {
  return {
    id: `comment-1`,
    post_id: "post-1",
    user_id: "commenter-1",
    content: "Nice post!",
    content_json: null,
    created_at: "2025-01-15T11:00:00Z",
    updated_at: "2025-01-15T11:00:00Z",
    author: { username: "commenter", is_anonymous: false, avatar_url: null },
    ...overrides,
  };
}

let ProfileWallComponent: any;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ProfileWall", () => {
  beforeAll(async () => {
    const mod = await import("./ProfileWall");
    ProfileWallComponent = mod.ProfileWall;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockWsService.on.mockReturnValue(vi.fn());
    // Default: comments already positioned fine → no nudge. Individual tests
    // override this to exercise the scroll branch.
    vi.mocked(shouldScrollToComments).mockReturnValue(false);
  });

  afterEach(() => {
    // Clean up manually-added globals (vi.restoreAllMocks doesn't remove these)
    if ((window as any).confirm !== undefined) {
      delete (window as any).confirm;
    }
    if ((navigator as any).clipboard !== undefined) {
      delete (navigator as any).clipboard;
    }
    vi.restoreAllMocks();
  });

  // ─── ProfileWall: showWall ──────────────────────────────────────────────────

  it("returns null when showWall is false", () => {
    setupApiMocks();
    const { container } = render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={false}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  // ─── ProfileWall: loading ───────────────────────────────────────────────────

  it("shows loading skeleton while fetching posts", () => {
    // Use makeChain with a never-resolving promise to keep loading=true
    mockFrom.mockReturnValue({
      ...makeChain(null),
      select: () => ({
        ...makeChain(null),
        eq: () => ({
          ...makeChain(null),
          // Support 3 .order() calls
          order: () => ({
            ...makeChain(null),
            order: () => ({
              ...makeChain(null),
              order: () => new Promise<never>(() => {}), // never resolves
            }),
          }),
        }),
      }),
    });

    const { container } = render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    const skeletonDivs = container.querySelectorAll(".animate-pulse");
    expect(skeletonDivs.length).toBeGreaterThan(0);
  });

  // ─── ProfileWall: empty state ───────────────────────────────────────────────

  it("shows empty state when no posts", async () => {
    setupApiMocks({ posts: [] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("На стене пока тихо")).toBeInTheDocument();
    });
  });

  // ─── ProfileWall: hidden wall (private profile) ────────────────────────────

  it("shows a private-profile notice when wallHidden is true and skips fetching", async () => {
    setupApiMocks({ posts: [] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={false}
        showWall={true}
        wallHidden
        privateProfile
      />
    );

    // The private notice explains why the wall is hidden.
    expect(screen.getByText("Приватный профиль")).toBeInTheDocument();
    expect(screen.getByText("Это приватный профиль — стена скрыта от не-друзей.")).toBeInTheDocument();
    // The misleading empty state must not appear.
    expect(screen.queryByText("На стене пока тихо")).not.toBeInTheDocument();
    expect(screen.queryByText("Нажмите `+`, чтобы оставить первую запись.")).not.toBeInTheDocument();
    // No fetch happened and no WebSocket subscription was made.
    expect(mockFrom).not.toHaveBeenCalledWith("profile_wall_posts");
    expect(mockWsService.subscribe).not.toHaveBeenCalled();
  });

  it("words the notice differently for a public profile whose wall is hidden", async () => {
    setupApiMocks({ posts: [] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={false}
        showWall={true}
        wallHidden
        privateProfile={false}
      />
    );

    expect(screen.getByText("Стена скрыта")).toBeInTheDocument();
    expect(screen.getByText("Владелец скрыл стену — она доступна только друзьям.")).toBeInTheDocument();
    expect(screen.queryByText("На стене пока тихо")).not.toBeInTheDocument();
  });

  // ─── ProfileWall: renders posts ─────────────────────────────────────────────

  it("renders posts list from API", async () => {
    setupApiMocks({
      posts: [
        createMockPost({ id: "post-1", content: "First post" }),
        createMockPost({ id: "post-2", content: "Second post" }),
      ],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      const contents = screen.getAllByTestId("processed-content");
      const texts = contents.map((el) => el.textContent);
      expect(texts).toContain("First post");
      expect(texts).toContain("Second post");
    });
  });

  // ─── ProfileWall: create form (externally controlled) ───────────────────────

  it("shows the create post form when createOpen is true and hides it when closed", async () => {
    setupApiMocks({ posts: [] });

    const { rerender } = render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
        createOpen={false}
        onCreateOpenChange={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("На стене пока тихо")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("create-wall-post")).not.toBeInTheDocument();

    rerender(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
        createOpen={true}
        onCreateOpenChange={() => {}}
      />
    );

    expect(screen.getByTestId("create-wall-post")).toBeInTheDocument();
  });

  it("reports the close request through onCreateOpenChange", async () => {
    setupApiMocks({ posts: [] });
    const onCreateOpenChange = vi.fn();

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
        createOpen={true}
        onCreateOpenChange={onCreateOpenChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("На стене пока тихо")).toBeInTheDocument();
    });
    expect(screen.getByTestId("create-wall-post")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("mock-cancel"));
    expect(onCreateOpenChange).toHaveBeenCalledWith(false);
  });

  // ─── ProfileWall: canPost=false hides create form ───────────────────────────

  it("does not render the create form when canPost is false", async () => {
    setupApiMocks({ posts: [] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={false}
        showWall={true}
        createOpen={true}
        onCreateOpenChange={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("На стене пока тихо")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("create-wall-post")).not.toBeInTheDocument();
  });

  // ─── ProfileWall: WS subscription lifecycle ─────────────────────────────────

  it("subscribes to WebSocket room on mount and unsubscribes on unmount", async () => {
    const unsubscribeNewPost = vi.fn();
    const unsubscribeUpdatePost = vi.fn();
    const unsubscribeDeletePost = vi.fn();

    mockWsService.on
      .mockReturnValueOnce(unsubscribeNewPost)
      .mockReturnValueOnce(unsubscribeUpdatePost)
      .mockReturnValueOnce(unsubscribeDeletePost);

    setupApiMocks({ posts: [] });

    const { unmount } = render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(mockWsService.subscribe).toHaveBeenCalledWith("profile_wall_profile-user-1");
    });

    expect(mockWsService.on).toHaveBeenCalledWith("new_wall_post", expect.any(Function));
    expect(mockWsService.on).toHaveBeenCalledWith("update_wall_post", expect.any(Function));
    expect(mockWsService.on).toHaveBeenCalledWith("delete_wall_post", expect.any(Function));

    unmount();

    expect(unsubscribeNewPost).toHaveBeenCalled();
    expect(unsubscribeUpdatePost).toHaveBeenCalled();
    expect(unsubscribeDeletePost).toHaveBeenCalled();
  });

  // ─── ProfileWall: WS new_wall_post event ────────────────────────────────────

  it("adds new post via WebSocket new_wall_post event", async () => {
    let newPostHandler: (...args: any[]) => any = () => {};
    mockWsService.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
      if (event === "new_wall_post") {
        newPostHandler = handler;
      }
      return vi.fn();
    });

    setupApiMocks({ posts: [] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("На стене пока тихо")).toBeInTheDocument();
    });

    act(() => {
      newPostHandler({
        data: {
          id: "ws-post-1",
          user_id: "profile-user-1",
          author_id: "author-2",
          title: "WS Post",
          content: "From WebSocket!",
          content_json: null,
          image_url: null,
          attachments: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          author: { username: "wsuser", is_anonymous: false, avatar_url: null },
        },
      });
    });

    await waitFor(() => {
      const contents = screen.getAllByTestId("processed-content");
      expect(contents.length).toBeGreaterThanOrEqual(1);
      // WS post is added at the beginning (index 0)
      expect(contents[0].textContent).toBe("From WebSocket!");
    });
  });

  // ─── ProfileWall: WS update_wall_post event ─────────────────────────────────

  it("updates post via WebSocket update_wall_post event", async () => {
    let updatePostHandler: (...args: any[]) => any = () => {};
    mockWsService.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
      if (event === "update_wall_post") {
        updatePostHandler = handler;
      }
      return vi.fn();
    });

    setupApiMocks({
      posts: [createMockPost({ id: "post-1", content: "Original content" })],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Original content")).toBeInTheDocument();
    });

    act(() => {
      updatePostHandler({
        data: {
          id: "post-1",
          content: "Updated content!",
          content_json: null,
          created_at: "2025-01-15T10:00:00Z",
          updated_at: "2025-01-15T10:00:00Z",
          author: { username: "testuser", is_anonymous: false, avatar_url: null },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Updated content!")).toBeInTheDocument();
    });
  });

  // ─── ProfileWall: WS delete_wall_post event ─────────────────────────────────

  it("removes post via WebSocket delete_wall_post event", async () => {
    let deletePostHandler: (...args: any[]) => any = () => {};
    mockWsService.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
      if (event === "delete_wall_post") {
        deletePostHandler = handler;
      }
      return vi.fn();
    });

    setupApiMocks({
      posts: [
        createMockPost({ id: "post-1", content: "First" }),
        createMockPost({ id: "post-2", content: "Second" }),
      ],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("First")).toBeInTheDocument();
      expect(screen.getByText("Second")).toBeInTheDocument();
    });

    act(() => {
      deletePostHandler({ data: { id: "post-1" } });
    });

    await waitFor(() => {
      expect(screen.queryByText("First")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  // ─── ProfileWall: focusedPostId ─────────────────────────────────────────────

  it("loads a single focused post when focusedPostId is provided", async () => {
    setupApiMocks({ posts: [createMockPost({ id: "focused-post", content: "Focused post" })] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={false}
        showWall={true}
        focusedPostId="focused-post"
        standalone={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Focused post")).toBeInTheDocument();
    });

    expect(screen.queryByText("Запись на стене не найдена")).not.toBeInTheDocument();
  });

  // ─── ProfileWall: focused post not found ────────────────────────────────────

  it("shows not found message when focusedPostId has no results", async () => {
    setupApiMocks({ posts: [] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={false}
        showWall={true}
        focusedPostId="nonexistent"
        standalone={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Запись на стене не найдена")).toBeInTheDocument();
    });
  });

  // ─── ProfileWall: error loading posts ───────────────────────────────────────

  it("shows error toast when loading posts fails", async () => {
    // Use makeChain but override select to return a rejecting chain
    const rejectChain = makeChain(null);
    rejectChain.select = () => ({
      ...makeChain(null),
      eq: () => ({
        ...makeChain(null),
        order: () => ({
          ...makeChain(null),
          order: () => ({
            ...makeChain(null),
            order: () => Promise.reject(new Error("Network error")),
          }),
        }),
      }),
    });

    mockFrom.mockReturnValue(rejectChain);

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Ошибка загрузки постов стены");
    });
  });

  // ─── WallPostCard: basic render ─────────────────────────────────────────────

  it("renders a wall post with content and author info", async () => {
    setupApiMocks({
      posts: [createMockPost({ id: "post-1", content: "My wall post" })],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("My wall post")).toBeInTheDocument();
    });

    expect(screen.getByTestId("user-badge")).toHaveTextContent("testuser");
  });

  // ─── WallPostCard: embedded interaction counts ──────────────────────────────

  it("renders embedded like/comment/repost counts and fires no per-post fetches", async () => {
    setupApiMocks({
      posts: [createMockPost({
        id: "count-post",
        content: "Counted post",
        likes_count: 5,
        comments_count: 2,
        reposts_count: 1,
        liked_by_viewer: true,
        my_repost_record_id: "rr-1",
        my_reposted_wall_post_id: "copy-1",
      })],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Counted post")).toBeInTheDocument();
    });

    // Counts come embedded in the wall GET — the client must not fire the old
    // per-post count/state queries (5 requests per post before this fix).
    expect(mockFrom).not.toHaveBeenCalledWith("profile_wall_post_likes");
    expect(mockFrom).not.toHaveBeenCalledWith("profile_wall_post_reposts");
    expect(mockFrom).toHaveBeenCalledWith("profile_wall_posts");

    // 5 likes, 2 comments, 1 repost rendered in the action row.
    const likeButton = screen.getByText("Нравится").closest("button");
    expect(likeButton).toHaveTextContent("5");
    const commentButton = screen.getByText("Комментировать").closest("button");
    expect(commentButton).toHaveTextContent("2");
    // Viewer already reposted → the label flips to "Убрать".
    const repostButton = screen.getByText("Убрать").closest("button");
    expect(repostButton).toHaveTextContent("1");
    // Liked by viewer → button is in active state (text-primary class).
    expect(likeButton?.className).toContain("text-primary");
  });

  // ─── WallPostCard: pinned indicator ─────────────────────────────────────────

  it("shows pinned badge for pinned posts", async () => {
    setupApiMocks({
      posts: [createMockPost({ id: "post-1", content: "Pinned post", is_pinned: true })],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Закреплено")).toBeInTheDocument();
    });
  });

  // ─── WallPostCard: like toggle ──────────────────────────────────────────────

  it("toggles like when clicking like button", async () => {
    setupApiMocks({ posts: [createMockPost()] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Hello wall!")).toBeInTheDocument();
    });

    // Click "Нравится" (like button)
    await userEvent.click(screen.getByText("Нравится"));

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("profile_wall_post_likes");
    });
  });

  // ─── WallPostCard: comments toggle ──────────────────────────────────────────

  it("opens comments section when clicking 'Комментировать'", async () => {
    setupApiMocks({
      posts: [createMockPost()],
      comments: [],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Hello wall!")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Комментировать"));

    await waitFor(() => {
      expect(screen.getByText("Тут пока пусто, но это можно исправить.")).toBeInTheDocument();
    });
  });

  it("keeps comments collapsed until the first fetch settles (no skeleton flash)", async () => {
    // A comments fetch that we resolve manually — the section must stay folded
    // (no "Тут пока пусто" and no skeleton visible) until it settles.
    let resolveComments!: (v: unknown) => void;
    const pendingComments = new Promise<unknown>((res) => { resolveComments = res; });
    const pendingChain = pendingComments as any;
    pendingChain.select = () => pendingChain;
    pendingChain.eq = () => pendingChain;
    pendingChain.order = () => pendingChain;
    pendingChain.in = () => pendingChain;
    pendingChain.limit = () => pendingChain;
    pendingChain.or = () => pendingChain;
    pendingChain.single = () => pendingChain;
    pendingChain.maybeSingle = () => pendingChain;
    pendingChain.insert = () => pendingChain;
    pendingChain.update = () => pendingChain;
    pendingChain.delete = () => pendingChain;

    mockFrom.mockImplementation((table: string) => {
      if (table === "profile_wall_post_comments") return pendingChain;
      if (table === "profile_wall_posts") return makeChain({ data: [createMockPost()], error: null });
      return makeChain({ data: [], error: null });
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Hello wall!")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Комментировать"));

    // Fetch is still in flight → the section must NOT show the empty state yet,
    // and the "Комментировать" button shows a spinner instead of its icon.
    expect(screen.queryByText("Тут пока пусто, но это можно исправить.")).not.toBeInTheDocument();
    const commentButton = screen.getByText("Комментировать").closest("button");
    expect(commentButton?.querySelector(".animate-spin")).toBeTruthy();

    await act(async () => {
      resolveComments({ data: [], error: null });
    });

    await waitFor(() => {
      expect(screen.getByText("Тут пока пусто, но это можно исправить.")).toBeInTheDocument();
    });
    // Once loaded, the spinner is gone.
    expect(commentButton?.querySelector(".animate-spin")).toBeFalsy();
  });

  it("does not refetch comments when reopening the section (mount-once)", async () => {
    setupApiMocks({
      posts: [createMockPost()],
      comments: [],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Hello wall!")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Комментировать"));
    await waitFor(() => {
      expect(screen.getByText("Тут пока пусто, но это можно исправить.")).toBeInTheDocument();
    });

    const fetchesAfterFirstOpen = mockFrom.mock.calls.filter(([t]) => t === "profile_wall_post_comments").length;

    // Close and reopen — the tree stays mounted, so no second fetch.
    await userEvent.click(screen.getByText("Комментировать"));
    await userEvent.click(screen.getByText("Комментировать"));
    await waitFor(() => {
      expect(screen.getByText("Тут пока пусто, но это можно исправить.")).toBeInTheDocument();
    });

    const fetchesAfterReopen = mockFrom.mock.calls.filter(([t]) => t === "profile_wall_post_comments").length;
    expect(fetchesAfterReopen).toBe(fetchesAfterFirstOpen);
  });

  it("nudges the page down when opening comments that start below the target line", async () => {
    vi.mocked(shouldScrollToComments).mockReturnValue(true);
    setupApiMocks({
      posts: [createMockPost()],
      comments: [],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Hello wall!")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Комментировать"));

    // The nudge fires immediately once the fetch settles — no artificial delay
    // (the mock fetch resolves in a microtask, so this runs right after click).
    await waitFor(() => {
      expect(smoothScrollToElement).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        expect.objectContaining({ block: "start", duration: 650 }),
      );
    });
  });

  it("leaves the page alone when the comments already start high enough", async () => {
    setupApiMocks({
      posts: [createMockPost()],
      comments: [],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Hello wall!")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Комментировать"));

    await waitFor(() => {
      expect(screen.getByText("Тут пока пусто, но это можно исправить.")).toBeInTheDocument();
    });
    expect(smoothScrollToElement).not.toHaveBeenCalled();
  });

  it("does not auto-scroll when comments are force-opened on mount", async () => {
    vi.mocked(shouldScrollToComments).mockReturnValue(true);
    setupApiMocks({
      posts: [createMockPost({ id: "focused-post", content: "Focused" })],
      comments: [],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={false}
        showWall={true}
        focusedPostId="focused-post"
        standalone={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Тут пока пусто, но это можно исправить.")).toBeInTheDocument();
    });
    expect(smoothScrollToElement).not.toHaveBeenCalled();
  });

  // ─── WallPostCard: comments with list ───────────────────────────────────────

  it("shows comments list when comments are loaded", async () => {
    setupApiMocks({
      posts: [createMockPost()],
      comments: [createMockComment({ content: "First comment" })],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Hello wall!")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Комментировать"));

    await waitFor(() => {
      expect(screen.getByText("First comment")).toBeInTheDocument();
    });
  });

  // ─── WallPostCard: delete post ──────────────────────────────────────────────

  it("deletes a post (author can see delete button)", async () => {
    setupApiMocks({
      posts: [createMockPost({ id: "post-1", author_id: "current-user", content: "To delete" })],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("To delete")).toBeInTheDocument();
    });

    const deleteButton = screen.getByTitle("Удалить");
    await userEvent.click(deleteButton);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Пост удален");
    });
  });

  // ─── WallPostCard: share sheet ──────────────────────────────────────────────

  it("opens the share sheet when clicking the share button", async () => {
    setupApiMocks({ posts: [createMockPost()] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Hello wall!")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("share-sheet")).not.toBeInTheDocument();

    // Share ActionButton has showLabel=false — no visible label text, only the Share2 icon.
    // Exclude the "Написать на стене" button which also has only an icon.
    const buttons = screen.getAllByRole("button");
    const shareButton = buttons.find((btn) => {
      const hasNoText = btn.textContent?.trim() === "";
      const isNotPlusButton = btn.getAttribute("title") !== "Написать на стене";
      return hasNoText && isNotPlusButton;
    });
    expect(shareButton).toBeTruthy();
    await userEvent.click(shareButton!);

    await waitFor(() => {
      expect(screen.getByTestId("share-sheet")).toBeInTheDocument();
    });
  });

  // ─── WallPostCard: repost of original post ──────────────────────────────────

  it("shows embedded original post when post is a repost", async () => {
    const originalPost = createMockPost({
      id: "original-1",
      author_id: "original-author",
      content: "Original content",
      author: { username: "originaluser", is_anonymous: false, avatar_url: null },
    });

    // Need BOTH posts in mock data: the repost post AND the original post,
    // because loadPosts() does a separate fetch for repost IDs.
    setupApiMocks({
      posts: [
        createMockPost({
          id: "repost-1",
          repost_of_post_id: "original-1",
          content: "My repost",
          original_post: null, // will be filled by loadPosts
        }),
        originalPost,
      ],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("My repost")).toBeInTheDocument();
    });

    expect(screen.getByText("Оригинальная запись")).toBeInTheDocument();
    // Original content appears both as embedded and potentially as standalone in the list
    expect(screen.getAllByText("Original content").length).toBeGreaterThanOrEqual(1);
  });

  // ─── ProfileWall: no WS subscription when no currentUserId ──────────────────

  it("does not subscribe to WebSocket when currentUserId is null", async () => {
    setupApiMocks({ posts: [] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId={null}
        currentUsername=""
        canPost={false}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("На стене пока тихо")).toBeInTheDocument();
    });

    expect(mockWsService.subscribe).not.toHaveBeenCalled();
  });

  // ─── WallPostCard: repost dialog submit ─────────────────────────────────────

  it("opens repost dialog and submits repost", async () => {
    setupApiMocks({ posts: [createMockPost({ id: "post-1", content: "Repost this!" })] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Repost this!")).toBeInTheDocument();
    });

    // Click "Репост" button
    await userEvent.click(screen.getByText("Репост"));

    await waitFor(() => {
      expect(screen.getByText("Репост записи")).toBeInTheDocument();
    });

    // Type in the repost editor and submit
    const textarea = screen.getByTestId("rich-editor-textarea");
    await userEvent.type(textarea, "My comment{Enter}");

    await waitFor(() => {
      // profileUserId="profile-user-1" ≠ currentUserId="current-user", different user
      expect(toast.success).toHaveBeenCalledWith("Репост отправлен на вашу стену");
    });
  });

  // ─── ProfileWall: image attachment render ───────────────────────────────────

  it("renders image attachment inside a wall post", async () => {
    setupApiMocks({
      posts: [
        createMockPost({
          id: "post-with-image",
          attachments: [
            { url: "img.jpg", type: "image", mime: "image/jpeg", name: "test.jpg", size: 0 },
          ],
        }),
      ],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      const imageBtns = screen.getAllByRole("button", { name: /test/i });
      expect(imageBtns.length).toBeGreaterThanOrEqual(1);
    });

    // Verify the image renders inside the post
    const img = screen.getByAltText("test.jpg");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src");
  });

  // ─── ProfileWall: standalone mode hides create form ─────────────────────────

  it("does not render the create form in standalone mode", async () => {
    setupApiMocks({ posts: [] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
        standalone={true}
        createOpen={true}
        onCreateOpenChange={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("На стене пока тихо")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("create-wall-post")).not.toBeInTheDocument();
  });

  // ─── ProfileWall: pinned posts sorted first ─────────────────────────────────

  it("renders pinned posts first (sorted by component)", async () => {
    setupApiMocksWithCounts({
      posts: [
        createMockPost({ id: "post-1", content: "Regular post", is_pinned: false, pinned_order: null, created_at: "2025-01-20T10:00:00Z" }),
        createMockPost({ id: "post-2", content: "Pinned post", is_pinned: true, pinned_order: 0, created_at: "2025-01-10T10:00:00Z" }),
      ],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      const contents = screen.getAllByTestId("processed-content");
      expect(contents.length).toBeGreaterThanOrEqual(2);
      // Find process-content elements that contain the post text
      const postTexts = contents
        .map((el) => el.textContent)
        .filter((t) => t === "Pinned post" || t === "Regular post");
      // Pinned should come first among the post texts
      expect(postTexts[0]).toBe("Pinned post");
      expect(postTexts[1]).toBe("Regular post");
    });
  });

  // ─── WallPostCard: post with only attachments (no text) ───────────────────────

  it("does not render content block for posts with only attachments", async () => {
    setupApiMocks({
      posts: [createMockPost({
        id: "attach-only",
        content: null,
        content_json: null,
        attachments: [{ url: "img.jpg", type: "image", mime: "image/jpeg", name: "photo.jpg", size: 0 }],
      })],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      // Image should be rendered
      const img = screen.getByAltText("photo.jpg");
      expect(img).toBeInTheDocument();
    });

    // No processed-content should exist since there's no text content
    const processedContents = screen.queryAllByTestId("processed-content");
    expect(processedContents.length).toBe(0);
  });

  // ─── WallPostCard: whole card opens the post ────────────────────────────────

  it("opens the post when clicking dead space on a photo-only post", async () => {
    setupApiMocks({
      posts: [createMockPost({
        id: "photo-only",
        content: null,
        content_json: null,
        attachments: [{ url: "img.jpg", type: "image", mime: "image/jpeg", name: "photo.jpg", size: 0 }],
      })],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByAltText("photo.jpg")).toBeInTheDocument();
    });

    // The non-interactive views counter in the action row is dead space —
    // clicking it must open the post (photo-only posts have no text block to
    // click on, so the whole card is the tap target).
    await userEvent.click(screen.getByTestId("post-views-count"));

    expect(mockNavigate).toHaveBeenCalledWith(
      "/profile/profile-user-1/wall/photo-only",
      expect.objectContaining({ state: expect.objectContaining({ wallPost: expect.objectContaining({ id: "photo-only" }) }) })
    );
  });

  it("opens the post when clicking the pinned badge in the header", async () => {
    setupApiMocks({ posts: [createMockPost({ id: "pinned-post", is_pinned: true })] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Закреплено")).toBeInTheDocument();
    });

    // The badge is plain text in the header (right of the nickname, next to
    // the time) — clicking it opens the post, not the user profile.
    await userEvent.click(screen.getByText("Закреплено"));

    expect(mockNavigate).toHaveBeenCalledWith(
      "/profile/profile-user-1/wall/pinned-post",
      expect.objectContaining({ state: expect.objectContaining({ wallPost: expect.objectContaining({ id: "pinned-post" }) }) })
    );
  });

  it("opens the post with Enter when the card is focused", async () => {
    setupApiMocks({ posts: [createMockPost()] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Hello wall!")).toBeInTheDocument();
    });

    const card = screen.getByText("Hello wall!").closest(".cursor-pointer");
    expect(card).not.toBeNull();
    fireEvent.keyDown(card!, { key: "Enter" });

    expect(mockNavigate).toHaveBeenCalledWith(
      "/profile/profile-user-1/wall/post-1",
      expect.objectContaining({ state: expect.objectContaining({ wallPost: expect.objectContaining({ id: "post-1" }) }) })
    );
  });

  it("does not open the post when clicking action buttons (like toggles instead)", async () => {
    setupApiMocks({ posts: [createMockPost()] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Hello wall!")).toBeInTheDocument();
    });

    // Click directly on the heart SVG icon — the target is an SVGElement, not
    // an HTMLElement, so the interactive-target check must still find the
    // enclosing button and let the like fire without navigating.
    const likeButton = screen.getByText("Нравится").closest("button");
    expect(likeButton).not.toBeNull();
    const heartIcon = likeButton!.querySelector("svg");
    expect(heartIcon).not.toBeNull();
    fireEvent.click(heartIcon!);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("profile_wall_post_likes");
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // ─── WallPostCard: post with text + attachments ──────────────────────────────

  it("renders both text content and attachments", async () => {
    setupApiMocks({
      posts: [createMockPost({
        id: "text-and-attach",
        content: "Text with attachment",
        attachments: [{ url: "img.jpg", type: "image", mime: "image/jpeg", name: "pic.jpg", size: 0 }],
      })],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      // Text content should render
      const contentElements = screen.getAllByTestId("processed-content");
      expect(contentElements.some(el => el.textContent === "Text with attachment")).toBe(true);
      // Image should also render
      const img = screen.getByAltText("pic.jpg");
      expect(img).toBeInTheDocument();
    });
  });

  // ─── WallPostCard: video attachment ──────────────────────────────────────────

  it("renders video attachment via MediaPlayer", async () => {
    setupApiMocks({
      posts: [createMockPost({
        id: "post-video",
        content: "Check this video",
        attachments: [{ url: "video.webm", type: "video", mime: "video/webm", name: "clip.webm", size: 0 }],
      })],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      const player = screen.getByTestId("media-player");
      expect(player).toBeInTheDocument();
      expect(player).toHaveAttribute("data-kind", "video");
    });
  });

  // ─── WallPostCard: audio attachment ──────────────────────────────────────────

  it("renders audio attachment via AudioAttachment", async () => {
    setupApiMocks({
      posts: [createMockPost({
        id: "post-audio",
        content: "Listen to this",
        attachments: [{ url: "track.ogg", type: "audio", mime: "audio/ogg", name: "song.ogg", size: 5000000 }],
      })],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      const audio = screen.getByTestId("audio-attachment");
      expect(audio).toBeInTheDocument();
      expect(audio).toHaveTextContent("song.ogg");
    });
  });

  // ─── WallPostCard: WS deduplication ──────────────────────────────────────────

  it("deduplicates posts arriving via WebSocket (same id twice)", async () => {
    let newPostHandler: (...args: any[]) => any = () => {};
    mockWsService.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
      if (event === "new_wall_post") {
        newPostHandler = handler;
      }
      return vi.fn();
    });

    setupApiMocks({ posts: [] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("На стене пока тихо")).toBeInTheDocument();
    });

    const wsPostPayload = {
      data: {
        id: "dedup-post",
        user_id: "profile-user-1",
        author_id: "author-2",
        title: "Dedup",
        content: "Unique content",
        content_json: null,
        image_url: null,
        attachments: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        author: { username: "dedupuser", is_anonymous: false, avatar_url: null },
      },
    };

    // First event — adds the post
    act(() => { newPostHandler(wsPostPayload); });

    await waitFor(() => {
      const contents = screen.getAllByTestId("processed-content");
      expect(contents.length).toBe(1);
      expect(contents[0].textContent).toBe("Unique content");
    });

    // Second event with same id — should be deduplicated
    act(() => { newPostHandler(wsPostPayload); });

    // Still only one post
    const contents = screen.queryAllByTestId("processed-content");
    expect(contents.length).toBe(1);
  });

  // ─── WallPostCard: WS ignores other walls ────────────────────────────────────

  it("ignores WebSocket posts for other profile walls", async () => {
    let newPostHandler: (...args: any[]) => any = () => {};
    mockWsService.on.mockImplementation((event: string, handler: (...args: any[]) => any) => {
      if (event === "new_wall_post") {
        newPostHandler = handler;
      }
      return vi.fn();
    });

    setupApiMocks({ posts: [] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("На стене пока тихо")).toBeInTheDocument();
    });

    act(() => {
      newPostHandler({
        data: {
          id: "other-wall",
          user_id: "other-user", // different from profileUserId="profile-user-1"
          content: "Wrong wall!",
          created_at: new Date().toISOString(),
          author: { username: "otheruser", is_anonymous: false, avatar_url: null },
        },
      });
    });

    // Post should NOT appear — empty state remains
    await waitFor(() => {
      expect(screen.getByText("На стене пока тихо")).toBeInTheDocument();
    });
    const contents = screen.queryAllByTestId("processed-content");
    expect(contents.length).toBe(0);
  });

  // ─── WallPostCard: delete comment ────────────────────────────────────────────

  it("deletes a comment", async () => {
    setupApiMocks({
      posts: [createMockPost()],
      comments: [createMockComment({ id: "comment-to-del", user_id: "current-user", content: "Delete this" })],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Hello wall!")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Комментировать"));

    await waitFor(() => {
      expect(screen.getByText("Delete this")).toBeInTheDocument();
    });

    const deleteCommentButton = screen.getByTitle("Удалить");
    await userEvent.click(deleteCommentButton);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Комментарий удалён");
    });
  });

  // ─── WallPostCard: pin button for wall owner ─────────────────────────────────

  it("shows pin button when current user is the wall owner", async () => {
    setupApiMocks({
      posts: [createMockPost({ id: "pin-post", user_id: "current-user", author_id: "other" })],
    });

    render(
      <ProfileWallComponent
        profileUserId="current-user"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle("Закрепить пост")).toBeInTheDocument();
    });
  });

  // ─── WallPostCard: edit button for author ────────────────────────────────────

  it("shows edit button when current user is the post author", async () => {
    setupApiMocks({
      posts: [createMockPost({ id: "edit-post", author_id: "current-user" })],
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle("Редактировать")).toBeInTheDocument();
    });
  });

  // ─── WallPostCard: no management for other users ────────────────────────────

  it("hides management buttons for non-author non-owner users", async () => {
    setupApiMocks({
      posts: [createMockPost()], // author_id: "author-1", user_id: "profile-user-1"
    });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="stranger"
        currentUsername="stranger"
        canPost={false}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Hello wall!")).toBeInTheDocument();
    });

    expect(screen.queryByTitle("Редактировать")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Удалить")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Закрепить пост")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Открепить пост")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Закрепить")).not.toBeInTheDocument();
  });
});
