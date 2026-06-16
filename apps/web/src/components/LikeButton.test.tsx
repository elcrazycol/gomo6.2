import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { LikeButton } from "./LikeButton";

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
    rpc: (...args: any[]) => mockRpc(...args),
  },
}));

const mockLoadLikeData = vi.fn(async () => ({ count: 0, isLiked: false, timestamp: Date.now() }));
vi.mock("@/contexts/LikesCacheContext", () => ({
  useLikesCache: () => ({
    getLikeData: vi.fn(() => null),
    loadLikeData: mockLoadLikeData,
    updateLikeData: vi.fn(),
    clearCache: vi.fn(),
  }),
}));

vi.mock("@/components/UserBadge", () => ({
  UserBadge: ({ username }: any) => <span data-testid="user-badge">{username}</span>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children, asChild }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div data-testid="tooltip-content">{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, className, variant, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} className={className} {...props}>
      {children}
    </button>
  ),
}));

function makeChain<T>(resolveValue: T): any {
  const p = Promise.resolve(resolveValue) as any;
  p.select = () => p;
  p.eq = () => p;
  p.insert = () => {
    const insertP = Promise.resolve({ data: { id: "new-id" }, error: null }) as any;
    return insertP;
  };
  p.delete = () => {
    const delP = Promise.resolve({ data: null, error: null }) as any;
    delP.eq = () => delP;
    return delP;
  };
  return p;
}

describe("LikeButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_post_likes_count") return Promise.resolve({ data: 0, error: null });
      if (fn === "has_user_liked_post") return Promise.resolve({ data: false, error: null });
      if (fn === "get_recent_post_likers") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });
    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
  });

  it("renders like button for authenticated user", () => {
    render(<LikeButton postId="post-1" currentUserId="user-1" />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("shows read-only heart for unauthenticated user", () => {
    render(<LikeButton postId="post-1" currentUserId={null} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("loads and displays initial like count", async () => {
    mockLoadLikeData.mockResolvedValueOnce({ count: 5, isLiked: false, timestamp: Date.now() });
    render(<LikeButton postId="post-1" currentUserId="user-1" />);
    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument();
    });
  });

  it("does not show count when 0", async () => {
    render(<LikeButton postId="post-1" currentUserId="user-1" />);
    await waitFor(() => {
      expect(screen.getByRole("button")).toBeInTheDocument();
    });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("toggles like on click", async () => {
    const user = userEvent.setup();
    render(<LikeButton postId="post-1" currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("post_likes");
    });
  });

  it("prevents liking own post", async () => {
    const user = userEvent.setup();
    render(
      <LikeButton
        postId="post-1"
        currentUserId="user-1"
        postAuthorId="user-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button"));

    expect(mockFrom).not.toHaveBeenCalledWith("post_likes");
  });

  it("calls onLikeChange callback after toggling", async () => {
    const onLikeChange = vi.fn();
    const user = userEvent.setup();
    render(
      <LikeButton postId="post-1" currentUserId="user-1" onLikeChange={onLikeChange} />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(onLikeChange).toHaveBeenCalled();
    });
  });

  it("uses thread tables when isThread is true", async () => {
    const user = userEvent.setup();
    render(
      <LikeButton postId="thread-1" currentUserId="user-1" isThread />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith("thread_likes");
    });
  });

  it("loads thread likes count when isThread", async () => {
    mockLoadLikeData.mockResolvedValueOnce({ count: 10, isLiked: true, timestamp: Date.now() });

    render(<LikeButton postId="thread-1" currentUserId="user-1" isThread />);
    await waitFor(() => {
      expect(screen.getByText("10")).toBeInTheDocument();
    });
  });

  it("shows tooltip with liker info on hover", async () => {
    mockLoadLikeData.mockResolvedValueOnce({ count: 3, isLiked: false, timestamp: Date.now() });
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_recent_post_likers") {
        return Promise.resolve({
          data: [{ username: "liker1", id: "l1" }, { username: "liker2", id: "l2" }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<LikeButton postId="post-1" currentUserId="user-1" />);
    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    await userEvent.hover(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByTestId("tooltip-content")).toBeInTheDocument();
    });
  });

  it("disables button while loading", async () => {
    let resolveInsert: (v: any) => void;
    mockFrom.mockImplementation((table: string) => {
      if (table === "post_likes") {
        const p = new Promise((resolve) => { resolveInsert = resolve; }) as any;
        p.select = () => p;
        p.insert = () => p;
        p.delete = () => { p.eq = () => p; return p; };
        p.eq = () => p;
        return p;
      }
      return makeChain({ data: null, error: null });
    });

    const user = userEvent.setup();
    render(<LikeButton postId="post-1" currentUserId="user-1" />);

    await waitFor(() => {
      expect(screen.getByRole("button")).not.toBeDisabled();
    });

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeDisabled();
    });
  });
});
