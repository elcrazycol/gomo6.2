import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockFrom = vi.fn();
vi.mock("@/integrations/api/compat", () => ({
  api: { from: (...args: any[]) => mockFrom(...args) },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/WallPostCard", () => ({
  WallPostCard: ({ post, onDeletePost, onTogglePin }: any) => (
    <div data-testid="album-wall-post" data-post-id={post.id}>
      <span>{post.content || post.title}</span>
      <button onClick={() => onDeletePost(post.id)}>Delete</button>
      <button onClick={() => onTogglePin(post.id)}>Pin</button>
    </div>
  ),
}));

vi.mock("@/components/CreateWallPost", () => ({
  CreateWallPost: () => <div data-testid="create-wall-post" />,
}));

vi.mock("@/components/Lightbox", () => ({
  Lightbox: () => <div data-testid="lightbox" />,
}));

vi.mock("@/components/PentagramLoader", () => ({
  PentagramLoader: () => <div data-testid="pentagram-loader">Loading...</div>,
}));

vi.mock("@/utils/storage", () => ({ storageUrl: () => null }));

function makeChain<T>(resolveValue: T): any {
  const p = Promise.resolve(resolveValue) as any;
  p.select = () => p;
  p.eq = () => p;
  p.order = () => p;
  p.in = () => p;
  p.limit = () => p;
  p.range = () => p;
  p.cursor = () => p;
  p.or = () => p;
  p.single = () => p;
  p.maybeSingle = () => p;
  p.insert = () => p;
  p.update = () => p;
  p.delete = () => p;
  return p;
}

const ALBUM = { id: "album-1", name: "Лучшее", post_count: 1 };

const ALBUM_POST = {
  id: "post-1",
  user_id: "profile-user-1",
  author_id: "author-1",
  title: "",
  content: "Пост в альбоме",
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
};

const WALL_POST = {
  ...ALBUM_POST,
  id: "post-2",
  content: "Пост со стены",
};

let ProfileAlbumViewComponent: any;

function renderAlbumView(overrides: Record<string, unknown> = {}) {
  const props = {
    album: ALBUM,
    profileUserId: "profile-user-1",
    currentUserId: "current-user",
    currentUsername: "currentuser",
    currentUserColor: "",
    isOwnProfile: true,
    onAddPosts: vi.fn().mockResolvedValue(undefined),
    onRemovePost: vi.fn().mockResolvedValue(undefined),
    onRenameAlbum: vi.fn().mockResolvedValue(undefined),
    onDeleteAlbum: vi.fn().mockResolvedValue(undefined),
    onAlbumPostsChanged: vi.fn(),
    ...overrides,
  };
  const view = render(<ProfileAlbumViewComponent {...(props as any)} />);
  return { ...view, props };
}

// ─── IntersectionObserver stub (for infinite scroll tests) ───────────────────

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  private callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe = vi.fn();
  disconnect = vi.fn();

  /** Fires the observer with the sentinel intersecting, as if it scrolled into view. */
  fire() {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

const lastObserver = () => MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1];

function makeAlbumPost(id: string, content: string) {
  return {
    id,
    user_id: "profile-user-1",
    author_id: "author-1",
    title: "",
    content,
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
  };
}

beforeEach(() => {
  // afterEach unstubs globals, so restore the fetch binding for every test.
  vi.stubGlobal("fetch", mockFetch);
  vi.clearAllMocks();
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/api/v1/profile_album_posts")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [ALBUM_POST] }) });
    }
    if (url.includes("/api/v1/profile_wall_posts")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [WALL_POST] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
  });
  mockFrom.mockReturnValue(makeChain({ data: null, error: null }));
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ProfileAlbumView", () => {
  beforeAll(async () => {
    const mod = await import("./ProfileAlbumView");
    ProfileAlbumViewComponent = mod.ProfileAlbumView;
  });

  afterEach(() => {
    MockIntersectionObserver.instances = [];
    vi.unstubAllGlobals();
  });

  it("loads the album posts", async () => {
    renderAlbumView();
    await waitFor(() => {
      expect(screen.getByTestId("album-wall-post")).toHaveTextContent("Пост в альбоме");
    });
  });

  it("shows the empty state when the album has no posts", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/v1/profile_album_posts")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });
    renderAlbumView();
    await waitFor(() => {
      expect(screen.getByText("В альбоме пока нет постов")).toBeInTheDocument();
    });
  });

  it("hides management buttons for non-owners", async () => {
    renderAlbumView({ isOwnProfile: false });
    await waitFor(() => {
      expect(screen.getByTestId("album-wall-post")).toBeInTheDocument();
    });
    // No management UI at all for visitors.
    expect(screen.queryByTitle("Добавить посты")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Изменить альбом")).not.toBeInTheDocument();
  });

  it("adds a post to the album from the picker", async () => {
    const { props } = renderAlbumView();
    await waitFor(() => {
      expect(screen.getByTestId("album-wall-post")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTitle("Добавить посты"));

    // The picker lists the wall post (post-2 is not in the album yet).
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Пост со стены")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByText("Пост со стены"));
    await waitFor(() => {
      expect(props.onAddPosts).toHaveBeenCalledWith(["post-2"]);
    });
  });

  it("removes a post from the album by unchecking it in the picker", async () => {
    // The album post (post-1) is already in the album → its row is checked.
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/v1/profile_album_posts")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [ALBUM_POST] }) });
      }
      if (url.includes("/api/v1/profile_wall_posts")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [ALBUM_POST] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });
    const { props } = renderAlbumView();
    await waitFor(() => {
      expect(screen.getByTestId("album-wall-post")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTitle("Добавить посты"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByText("Пост в альбоме"));

    await waitFor(() => {
      expect(props.onRemovePost).toHaveBeenCalledWith("post-1");
    });
  });

  it("renames the album through the rename dialog", async () => {
    const { props } = renderAlbumView();
    await waitFor(() => {
      expect(screen.getByTestId("album-wall-post")).toBeInTheDocument();
    });

    // Rename lives inside the album ⋮ menu.
    await userEvent.click(screen.getByTitle("Изменить альбом"));
    await userEvent.click(screen.getByTitle("Переименовать"));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByPlaceholderText("Название альбома");
    await userEvent.clear(input);
    await userEvent.type(input, "Новое имя");
    await userEvent.click(within(dialog).getByText("Сохранить"));

    await waitFor(() => {
      expect(props.onRenameAlbum).toHaveBeenCalledWith("Новое имя");
    });
  });

  it("deletes the album after confirmation", async () => {
    const { props } = renderAlbumView();
    await waitFor(() => {
      expect(screen.getByTestId("album-wall-post")).toBeInTheDocument();
    });

    // Delete lives inside the album ⋮ menu.
    await userEvent.click(screen.getByTitle("Изменить альбом"));
    await userEvent.click(screen.getByTitle("Удалить альбом"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByText("Удалить"));

    await waitFor(() => {
      expect(props.onDeleteAlbum).toHaveBeenCalled();
    });
  });

  it("keeps auto-loading when the sentinel stays visible (fast-scroll fling)", async () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    let pageIdx = 0;
    const cursorRequests: string[] = [];
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/v1/profile_album_posts")) {
        const m = url.match(/cursor=([^&]+)/);
        if (m) cursorRequests.push(decodeURIComponent(m[1]));
        if (pageIdx === 0) {
          pageIdx++;
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                data: Array.from({ length: 10 }, (_, i) => makeAlbumPost(`album-0${i}`, `Album 0${i}`)),
                has_more: true,
                next_cursor: "album-cursor-1",
              }),
          });
        }
        if (pageIdx === 1) {
          pageIdx++;
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                data: Array.from({ length: 10 }, (_, i) => makeAlbumPost(`album-1${i}`, `Album 1${i}`)),
                has_more: true,
                next_cursor: "album-cursor-2",
              }),
          });
        }
        pageIdx++;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [makeAlbumPost("album-20", "Album 20")],
              has_more: false,
              next_cursor: null,
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    renderAlbumView();
    await waitFor(() => {
      expect(screen.getByText("Album 00")).toBeInTheDocument();
    });
    expect(screen.getByTestId("album-sentinel")).toBeInTheDocument();

    // The user flings to the bottom: the sentinel fires ONCE and then stays
    // visible — the observer never fires again without an intersection
    // *change*, so any further loads must come from the post-append re-check.
    await act(async () => {
      lastObserver().fire();
    });
    await waitFor(() => {
      expect(screen.getByText("Album 19")).toBeInTheDocument();
    });
    expect(cursorRequests).toContain("album-cursor-1");

    // Nothing fires again, but the cooldown timer armed by the post-append
    // re-check must wake up and pull the next page on its own.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
    });
    await waitFor(() => {
      expect(screen.getByText("Album 20")).toBeInTheDocument();
    });
    expect(cursorRequests).toContain("album-cursor-2");

    // has_more is exhausted — the sentinel goes away.
    await waitFor(() => {
      expect(screen.queryByTestId("album-sentinel")).not.toBeInTheDocument();
    });
  });
});
