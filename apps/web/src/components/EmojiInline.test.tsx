import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmojiInline } from "./EmojiInline";

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
  p.maybeSingle = () => p;
  return p;
}

describe("EmojiInline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing", () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));
    const { container } = render(<EmojiInline code="smile" />);
    expect(container).toBeTruthy();
  });

  it("shows emoji image when found", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "emojis") {
        return makeChain({ data: { image_url: "smile.png", name: "Smile" }, error: null });
      }
      return makeChain({ data: null, error: null });
    });

    render(<EmojiInline code="smile" />);
    await waitFor(() => {
      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", "smile.png");
      expect(img).toHaveAttribute("alt", "Smile");
    });
  });

  it("shows code text when emoji not found", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "emojis") {
        return makeChain({ data: null, error: null });
      }
      return makeChain({ data: null, error: null });
    });

    render(<EmojiInline code="unknown" />);
    await waitFor(() => {
      expect(screen.getByText(":unknown:")).toBeInTheDocument();
    });
  });

  it("applies custom className", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "emojis") {
        return makeChain({ data: { image_url: "smile.png", name: "Smile" }, error: null });
      }
      return makeChain({ data: null, error: null });
    });

    render(<EmojiInline code="smile" className="custom" />);
    await waitFor(() => {
      const img = screen.getByRole("img");
      expect(img.className).toContain("custom");
    });
  });
});
