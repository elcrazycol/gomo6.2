import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProfileHoverCard } from "./ProfileHoverCard";

const mockFrom = vi.fn();
const mockGetProfileCustomization = vi.fn();
const mockUseQuery = vi.fn();
const mockUseUserRealtimeStatus = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
}));

vi.mock("@/utils/profileCustomization", () => ({
  getProfileCustomization: (...args: any[]) => mockGetProfileCustomization(...args),
  parseCssToStyle: () => ({}),
}));

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, keyOrUrl?: string | null) => keyOrUrl || null,
}));

vi.mock("@/utils/profileBio", () => ({
  processProfileBio: (text: string) => text,
}));

vi.mock("@/components/AdminBadge", () => ({
  AdminBadge: () => <span data-testid="admin-badge" />,
}));

vi.mock("@/components/OnlineStatus", () => ({
  OnlineStatus: ({ userId }: any) => <span data-testid="online-status">{userId}</span>,
}));

vi.mock("@/hooks/useRealtimeStatus", () => ({
  useUserRealtimeStatus: (...args: any[]) => mockUseUserRealtimeStatus(...args),
}));

describe("ProfileHoverCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({ data: null });
    mockGetProfileCustomization.mockResolvedValue(null);
  });

  it("renders children", () => {
    render(
      <ProfileHoverCard userId="user-1">
        <span>Hover me</span>
      </ProfileHoverCard>,
    );
    expect(screen.getByText("Hover me")).toBeInTheDocument();
  });

  it("does not show card when disabled", async () => {
    const user = userEvent.setup();
    render(
      <ProfileHoverCard userId="user-1" disabled>
        <span>Hover me</span>
      </ProfileHoverCard>,
    );

    await user.hover(screen.getByText("Hover me"));
    expect(screen.queryByTestId("online-status")).not.toBeInTheDocument();
  });

  it("shows card on hover when data is available", async () => {
    mockUseQuery.mockReturnValue({
      data: {
        profile: { username: "testuser", id: "user-1", bio: "Hello", post_count: 10, created_at: "2025-01-01T00:00:00Z" },
        avatarUrl: null,
        usernameColor: "",
        customization: null,
        placeholders: null,
      },
    });

    const user = userEvent.setup();
    render(
      <ProfileHoverCard userId="user-1">
        <span>Hover me</span>
      </ProfileHoverCard>,
    );

    await user.hover(screen.getByText("Hover me"));

    await waitFor(() => {
      expect(screen.getByText("testuser")).toBeInTheDocument();
    });
  });

  it("enables query only when hovering", () => {
    render(
      <ProfileHoverCard userId="user-1">
        <span>Hover me</span>
      </ProfileHoverCard>,
    );

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
      }),
    );
  });

  it("shows avatar when available", async () => {
    mockUseQuery.mockReturnValue({
      data: {
        profile: { username: "testuser", id: "user-1", avatar_url: "avatar.jpg" },
        avatarUrl: "avatar.jpg",
        usernameColor: "",
        customization: null,
        placeholders: null,
      },
    });

    const user = userEvent.setup();
    render(
      <ProfileHoverCard userId="user-1">
        <span>Hover me</span>
      </ProfileHoverCard>,
    );

    await user.hover(screen.getByText("Hover me"));

    await waitFor(() => {
      expect(screen.getByAltText("Avatar")).toBeInTheDocument();
    });
  });

  it("shows default user icon when no avatar", async () => {
    mockUseQuery.mockReturnValue({
      data: {
        profile: { username: "testuser", id: "user-1" },
        avatarUrl: null,
        usernameColor: "",
        customization: null,
        placeholders: null,
      },
    });

    const user = userEvent.setup();
    render(
      <ProfileHoverCard userId="user-1">
        <span>Hover me</span>
      </ProfileHoverCard>,
    );

    await user.hover(screen.getByText("Hover me"));

    await waitFor(() => {
      expect(screen.getByText("testuser")).toBeInTheDocument();
    });
  });

  it("shows admin badge", async () => {
    mockUseQuery.mockReturnValue({
      data: {
        profile: { username: "admin", id: "admin-1" },
        avatarUrl: null,
        usernameColor: "",
        customization: null,
        placeholders: null,
      },
    });

    const user = userEvent.setup();
    render(
      <ProfileHoverCard userId="admin-1">
        <span>Hover me</span>
      </ProfileHoverCard>,
    );

    await user.hover(screen.getByText("Hover me"));

    await waitFor(() => {
      expect(screen.getByTestId("admin-badge")).toBeInTheDocument();
    });
  });

  it("shows online status", async () => {
    mockUseQuery.mockReturnValue({
      data: {
        profile: { username: "testuser", id: "user-1", is_online: true, last_seen: "2025-01-01T00:00:00Z" },
        avatarUrl: null,
        usernameColor: "",
        customization: null,
        placeholders: null,
      },
    });

    const user = userEvent.setup();
    render(
      <ProfileHoverCard userId="user-1">
        <span>Hover me</span>
      </ProfileHoverCard>,
    );

    await user.hover(screen.getByText("Hover me"));

    await waitFor(() => {
      expect(screen.getByTestId("online-status")).toBeInTheDocument();
    });
  });

  it("shows username with color class", async () => {
    mockUseQuery.mockReturnValue({
      data: {
        profile: { username: "colored", id: "user-1" },
        avatarUrl: null,
        usernameColor: "purple",
        customization: null,
        placeholders: null,
      },
    });

    const user = userEvent.setup();
    render(
      <ProfileHoverCard userId="user-1">
        <span>Hover me</span>
      </ProfileHoverCard>,
    );

    await user.hover(screen.getByText("Hover me"));

    await waitFor(() => {
      expect(screen.getByText("colored")).toBeInTheDocument();
    });
  });

  it("shows post count placeholder", async () => {
    mockUseQuery.mockReturnValue({
      data: {
        profile: { username: "testuser", id: "user-1", post_count: 42 },
        avatarUrl: null,
        usernameColor: "",
        customization: null,
        placeholders: null,
      },
    });

    const user = userEvent.setup();
    render(
      <ProfileHoverCard userId="user-1">
        <span>Hover me</span>
      </ProfileHoverCard>,
    );

    await user.hover(screen.getByText("Hover me"));

    await waitFor(() => {
      expect(screen.getByText(/42.*пост/)).toBeInTheDocument();
    });
  });

  it("calls useUserRealtimeStatus", () => {
    render(
      <ProfileHoverCard userId="user-1">
        <span>Hover me</span>
      </ProfileHoverCard>,
    );
    expect(mockUseUserRealtimeStatus).toHaveBeenCalledWith("user-1");
  });
});
