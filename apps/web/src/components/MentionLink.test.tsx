import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, keyOrUrl?: string | null) => keyOrUrl || null,
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, className, title }: any) => (
    <a href={to} className={className} title={title}>{children}</a>
  ),
}));

const mockFrom = vi.fn();
vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

function makeChain<T>(resolveValue: T): any {
  const p = Promise.resolve(resolveValue) as any;
  p.select = () => p;
  p.eq = () => p;
  p.single = () => p;
  return p;
}

let MentionLinkComponent: any;

describe("MentionLink", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import to get fresh module with cleared cache
    const mod = await import("./MentionLink");
    MentionLinkComponent = mod.MentionLink;
  });

  it("shows loading state initially", () => {
    mockFrom.mockReturnValue(new Promise(() => {}));
    render(<MentionLinkComponent username="testuser" />);
    expect(screen.getByText("testuser")).toBeInTheDocument();
  });

  it("renders link when user exists", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") {
        return makeChain({ data: { id: "user-1", username: "testuser", is_anonymous: false }, error: null });
      }
      if (table === "user_achievements") {
        return makeChain({ data: [], error: null });
      }
      return makeChain({ data: null, error: null });
    });

    render(<MentionLinkComponent username={`testuser-${Date.now()}`} />);
    await waitFor(() => {
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
    });
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", expect.stringContaining("/profile/"));
  });

  it("shows disabled state when user does not exist", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") {
        return makeChain({ data: null, error: { message: "not found" } });
      }
      return makeChain({ data: null, error: null });
    });

    const uniqueName = `ghostuser-${Date.now()}`;
    render(<MentionLinkComponent username={uniqueName} />);
    await waitFor(() => {
      expect(screen.getByText(uniqueName)).toBeInTheDocument();
    });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
