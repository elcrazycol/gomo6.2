import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WallPost from "./WallPost";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockParams: { userId?: string; postId?: string } = {};

vi.mock("@/integrations/api/compat", () => ({
  api: {
    auth: {
      // The page's unused getToken() helper calls getSession, but only
      // getUser is exercised at runtime.
      getUser: (...args: any[]) => mockGetUser(...args),
    },
  },
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

// The fetch stub is re-applied in beforeEach and intentionally never unstubbed:
// restoring the real jsdom fetch lets a late-resolving component promise call it
// with a relative URL, producing an unhandled "Failed to parse URL" rejection.
// Each test file runs in an isolated worker, so the stub cannot leak elsewhere.
function mockFetchProfiles(results: Record<string, { data: any[] }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const profile = results[url] ?? { data: [] };
      return Promise.resolve({
        json: () => Promise.resolve({ success: true, ...profile }),
      } as Response);
    }),
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WallPost page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams.userId = "wall-owner";
    mockParams.postId = "post-1";
    mockGetUser.mockResolvedValue({ data: { user: { id: "current-user" } } });
    mockFetchProfiles({
      "/api/v1/profiles?id=eq.wall-owner": { data: [{ id: "wall-owner", username: "owner" }] },
      "/api/v1/profiles?id=eq.current-user": { data: [{ id: "current-user", username: "currentuser" }] },
    });
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
    mockFetchProfiles({
      "/api/v1/profiles?id=eq.wall-owner": { data: [{ id: "wall-owner", username: "owner" }] },
    });

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
    mockFetchProfiles({});
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("profile-wall")).toBeInTheDocument();
    });
    expect(screen.getByText("Запись на стене")).toBeInTheDocument();
  });
});
