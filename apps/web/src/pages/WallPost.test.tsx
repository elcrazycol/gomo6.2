import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WallPost from "./WallPost";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockLoadProfile = vi.fn();
const mockGetCurrentUserMeta = vi.fn();
const mockNavigateFn = vi.fn();
const mockParams: { userId?: string; postId?: string } = {};

vi.mock("@/integrations/api/compat", () => ({
  api: {
    auth: {
      getUser: (...args: any[]) => mockGetUser(...args),
    },
  },
}));

vi.mock("@/contexts/ProfileCacheContext", () => ({
  useProfileCache: () => ({ loadProfile: (...args: any[]) => mockLoadProfile(...args) }),
}));

vi.mock("@/utils/currentUserMeta", () => ({
  getCurrentUserMeta: (...args: any[]) => mockGetCurrentUserMeta(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useParams: () => mockParams,
    useNavigate: () => mockNavigateFn,
  };
});

const mockProfileWall = vi.fn();
vi.mock("@/components/ProfileWall", () => ({
  ProfileWall: (props: any) => {
    mockProfileWall(props);
    return (
      <div data-testid="profile-wall" data-profile-user-id={props.profileUserId} data-focused-post-id={props.focusedPostId}>
        ProfileWall
      </div>
    );
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderPage(state?: unknown) {
  const entry = state === undefined
    ? "/profile/wall-owner/wall/post-1"
    : { pathname: "/profile/wall-owner/wall/post-1", state };
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <WallPost />
    </MemoryRouter>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WallPost page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams.userId = "wall-owner";
    mockParams.postId = "post-1";
    mockGetUser.mockResolvedValue({ data: { user: { id: "current-user" } } });
    mockLoadProfile.mockResolvedValue({ username: "owner", color: "", isAdmin: false, customization: null });
    mockGetCurrentUserMeta.mockResolvedValue({ username: "currentuser", roles: [], color: "" });
  });

  afterEach(() => {
    delete mockParams.userId;
    delete mockParams.postId;
  });

  it("shows 'Запись не найдена' when params are missing", () => {
    mockParams.userId = undefined;
    mockParams.postId = undefined;
    renderPage();
    expect(screen.getByText("Запись не найдена.")).toBeInTheDocument();
  });

  it("renders ProfileWall with the right props for an authenticated user", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("profile-wall")).toBeInTheDocument();
    });

    expect(mockProfileWall).toHaveBeenCalledWith(
      expect.objectContaining({
        profileUserId: "wall-owner",
        currentUserId: "current-user",
        currentUsername: "currentuser",
        canPost: false,
        showWall: true,
        focusedPostId: "post-1",
        standalone: true,
      }),
    );
    expect(screen.getByText("Запись на стене @owner")).toBeInTheDocument();
    expect(screen.getByText("Назад")).toBeInTheDocument();
  });

  it("passes the already-rendered wall post to ProfileWall during navigation", async () => {
    const wallPost = {
      id: "post-1",
      user_id: "wall-owner",
      author_id: "author-1",
      content: "Already rendered",
      title: "Already rendered",
      content_json: null,
      image_url: null,
      attachments: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      author: { username: "author", is_anonymous: false, avatar_url: null },
    };

    renderPage({ wallPost });

    await waitFor(() => {
      expect(mockProfileWall).toHaveBeenCalledWith(
        expect.objectContaining({ initialPost: wallPost }),
      );
    });
  });

  it("passes null currentUserId for anonymous visitors", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockLoadProfile.mockResolvedValue({ username: "owner", color: "", isAdmin: false, customization: null });
    mockGetCurrentUserMeta.mockResolvedValue({ username: "", roles: [], color: "" });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("profile-wall")).toBeInTheDocument();
    });

    expect(mockProfileWall).toHaveBeenCalledWith(
      expect.objectContaining({ currentUserId: null, currentUsername: "" }),
    );
  });

  it("does not render ProfileWall while the page context is loading", async () => {
    mockGetUser.mockReturnValue(new Promise(() => {}));
    renderPage();

    // Header still renders, but ProfileWall waits for loading to finish
    expect(screen.getByText("Назад")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-wall")).not.toBeInTheDocument();
  });

  it("falls back to a generic header when the profile has no username", async () => {
    mockLoadProfile.mockResolvedValue({ username: "", color: "", isAdmin: false, customization: null });
    mockGetCurrentUserMeta.mockResolvedValue({ username: "", roles: [], color: "" });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("profile-wall")).toBeInTheDocument();
    });
    expect(screen.getByText("Запись на стене")).toBeInTheDocument();
  });

  it("navigates back immediately and keeps a snapshot overlay on top", () => {
    Object.defineProperty(window.history, "length", { configurable: true, get: () => 5 });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));

    expect(mockNavigateFn).toHaveBeenCalledWith(-1);

    const overlay = document.body.querySelector<HTMLElement>("main[aria-hidden='true']");
    expect(overlay).not.toBeNull();
    expect(overlay!.style.position).toBe("fixed");
    expect(overlay!.getAttribute("data-testid")).toBeNull();
    // The exit slide is driven by a CSS variable so a swipe can start it from
    // wherever the finger left the page; the back button starts it at 0.
    expect(overlay!.style.getPropertyValue("--wall-post-exit-x")).toBe("0px");
    expect(overlay!.style.transform).toBe("translate3d(0px, 0, 0)");
  });

  it("navigates to the profile with replace when opened directly", () => {
    Object.defineProperty(window.history, "length", { configurable: true, get: () => 1 });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(mockNavigateFn).toHaveBeenCalledWith("/profile/wall-owner", { replace: true });
  });

  it("slides the snapshot away only after the destination is ready", () => {
    Object.defineProperty(window.history, "length", { configurable: true, get: () => 5 });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));

    const overlay = document.body.querySelector<HTMLElement>("main[aria-hidden='true']");
    expect(overlay).not.toBeNull();

    // Before the destination signals readiness the snapshot must stay put.
    expect(overlay!.classList.contains("wall-post-page-exit")).toBe(false);

    // Simulate the profile/feed finishing its render.
    const ready = document.createElement("div");
    ready.setAttribute("data-wall-return-ready", "profile");
    document.body.appendChild(ready);

    return waitFor(() => {
      expect(overlay!.classList.contains("wall-post-page-exit")).toBe(true);
    });
  });

  it("loads wall owner via ProfileCacheContext (cached) instead of a raw fetch", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("profile-wall")).toBeInTheDocument();
    });

    // Owner + current user are resolved through the shared caches, not fetch.
    expect(mockLoadProfile).toHaveBeenCalledWith("wall-owner");
    expect(mockGetCurrentUserMeta).toHaveBeenCalledWith("current-user");
  });
});
