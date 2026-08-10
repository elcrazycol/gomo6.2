import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useModeratorGate } from "./useModeratorGate";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockGetCurrentUserMeta = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: { auth: { getUser: (...args: any[]) => mockGetUser(...args) } },
}));

vi.mock("@/utils/currentUserMeta", () => ({
  getCurrentUserMeta: (...args: any[]) => mockGetCurrentUserMeta(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// ─── Harness ─────────────────────────────────────────────────────────────────

function GateProbe() {
  const { user, isModerator, currentUserUsername, currentUserColor } = useModeratorGate();
  if (!isModerator) return <div>no-access</div>;
  return (
    <div>
      <span>user-{user?.id}</span>
      <span>name-{currentUserUsername}</span>
      <span>color-{currentUserColor}</span>
    </div>
  );
}

function renderGate() {
  return render(
    <MemoryRouter>
      <GateProbe />
    </MemoryRouter>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useModeratorGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "mod-1" } }, error: null });
    mockGetCurrentUserMeta.mockResolvedValue({
      roles: ["moderator"],
      username: "moder",
      color: "purple",
    });
  });

  it("grants access to moderators and renders cached meta", async () => {
    renderGate();

    await waitFor(() => {
      expect(screen.getByText("user-mod-1")).toBeInTheDocument();
    });
    expect(screen.getByText("name-moder")).toBeInTheDocument();
    expect(screen.getByText("color-purple")).toBeInTheDocument();
    expect(mockGetUser).toHaveBeenCalledTimes(1);
    expect(mockGetCurrentUserMeta).toHaveBeenCalledWith("mod-1");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated users to /auth", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    renderGate();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/auth");
    });
    expect(screen.getByText("no-access")).toBeInTheDocument();
  });

  it("redirects non-moderators to / with an error toast", async () => {
    mockGetCurrentUserMeta.mockResolvedValue({ roles: ["user"], username: "x", color: "" });

    renderGate();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });
    expect(screen.getByText("no-access")).toBeInTheDocument();
  });

  it("re-runs the gate per mount but routes meta through the shared cache", async () => {
    // First mount fetches everything.
    renderGate();
    await waitFor(() => {
      expect(screen.getByText("user-mod-1")).toBeInTheDocument();
    });
    expect(mockGetUser).toHaveBeenCalledTimes(1);

    // Second mount calls getUser + getCurrentUserMeta again, but the hook only
    // reads the user id — the expensive user_roles/profiles/achievements
    // payload is served by getCurrentUserMeta's 5-minute TTL cache (covered in
    // currentUserMeta.test.ts). This asserts the wiring: meta never bypasses
    // the cache module for the raw 3-request sequence.
    renderGate();
    await waitFor(() => {
      expect(screen.getAllByText("user-mod-1")).toHaveLength(2);
    });
    expect(mockGetUser).toHaveBeenCalledTimes(2);
    expect(mockGetCurrentUserMeta).toHaveBeenCalledTimes(2);
    expect(mockGetCurrentUserMeta).toHaveBeenCalledWith("mod-1");
  });
});
