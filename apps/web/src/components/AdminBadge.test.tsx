import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdminBadge } from "./AdminBadge";

const mockGetProfile = vi.fn();
const mockLoadProfile = vi.fn();

vi.mock("@/contexts/ProfileCacheContext", () => ({
  useProfileCache: () => ({
    getProfile: (...args: any[]) => mockGetProfile(...args),
    loadProfile: (...args: any[]) => mockLoadProfile(...args),
  }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div data-testid="tooltip">{children}</div>,
}));

describe("AdminBadge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when user is not admin", async () => {
    mockGetProfile.mockReturnValue(null);
    mockLoadProfile.mockResolvedValue({ isAdmin: false });

    const { container } = render(<AdminBadge userId="user-1" />);
    await waitFor(() => {
      expect(mockLoadProfile).toHaveBeenCalledWith("user-1");
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders admin icon when user is admin", async () => {
    mockGetProfile.mockReturnValue(null);
    mockLoadProfile.mockResolvedValue({ isAdmin: true });

    render(<AdminBadge userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByText("администратор gomo6")).toBeInTheDocument();
    });
  });

  it("uses cached profile data", async () => {
    mockGetProfile.mockReturnValue({ isAdmin: true });

    render(<AdminBadge userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByText("администратор gomo6")).toBeInTheDocument();
    });
    expect(mockLoadProfile).not.toHaveBeenCalled();
  });

  it("loads profile when cache miss", async () => {
    mockGetProfile.mockReturnValue(null);
    mockLoadProfile.mockResolvedValue({ isAdmin: false });

    render(<AdminBadge userId="user-1" />);
    await waitFor(() => {
      expect(mockLoadProfile).toHaveBeenCalledWith("user-1");
    });
  });
});
