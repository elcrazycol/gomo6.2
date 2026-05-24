import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from "vitest";
import { toast } from "sonner";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockWsService = {
  subscribe: vi.fn(),
  on: vi.fn(() => vi.fn()),
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

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
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

vi.mock("@/components/ImageGallery", () => ({
  ImageGallery: ({ images, initialIndex, onClose }: any) => (
    <div data-testid="image-gallery" data-images={images?.length} data-index={initialIndex}>
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

// ─── Query Builder Mocks ─────────────────────────────────────────────────────

/**
 * Creates an infinitely chainable mock for Supabase-style query chains.
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

  // ─── ProfileWall: create form toggle ────────────────────────────────────────

  it("toggles create post form when + button is clicked", async () => {
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

    const plusButton = screen.getByTitle("Написать на стене");
    await userEvent.click(plusButton);

    expect(screen.getByTestId("create-wall-post")).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("Скрыть форму"));
    // CreateWallPost stays in DOM via CSS visibility, check the + button returned
    await waitFor(() => {
      expect(screen.getByTitle("Написать на стене")).toBeInTheDocument();
    });
  });

  // ─── ProfileWall: canPost=false hides create button ─────────────────────────

  it("hides the create button when canPost is false", async () => {
    setupApiMocks({ posts: [] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={false}
        showWall={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("На стене пока тихо")).toBeInTheDocument();
    });

    expect(screen.queryByTitle("Написать на стене")).not.toBeInTheDocument();
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
      expect(screen.getByText("Пока без комментариев")).toBeInTheDocument();
    });
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

  // ─── WallPostCard: share dialog ─────────────────────────────────────────────

  it("opens share dialog when clicking share button and copies URL", async () => {
    (navigator as any).clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

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
      expect(screen.getByText("Поделиться записью")).toBeInTheDocument();
    });

    const copyButton = screen.getByText("Копировать");
    await userEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Ссылка на запись скопирована");
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

  // ─── ProfileWall: standalone mode hides create button ───────────────────────

  it("hides create button in standalone mode", async () => {
    setupApiMocks({ posts: [] });

    render(
      <ProfileWallComponent
        profileUserId="profile-user-1"
        currentUserId="current-user"
        currentUsername="currentuser"
        canPost={true}
        showWall={true}
        standalone={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("На стене пока тихо")).toBeInTheDocument();
    });

    expect(screen.queryByTitle("Написать на стене")).not.toBeInTheDocument();
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
});
