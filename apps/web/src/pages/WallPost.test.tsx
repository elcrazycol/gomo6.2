import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WallPost from "./WallPost";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockLoadProfile = vi.fn();
const mockGetCurrentUserMeta = vi.fn();
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
  return { ...actual, useParams: () => mockParams };
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/profile/wall-owner/wall/post-1"]}>
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
    expect(screen.getByText("Назад к профилю")).toBeInTheDocument();
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
    expect(screen.getByText("Назад к профилю")).toBeInTheDocument();
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
