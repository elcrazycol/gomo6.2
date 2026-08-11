import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/components/EmojiInline", () => ({
  EmojiInline: ({ emojiId, code }: { emojiId?: string; code?: string }) => (
    <span data-testid="emoji">{emojiId ?? code ?? ""}</span>
  ),
}));
vi.mock("@/components/MentionLink", () => ({
  MentionLink: ({ username }: { username: string }) => (
    <span data-testid="mention">@{username}</span>
  ),
}));
vi.mock("@/components/LinkButton", () => ({
  LinkButton: ({ url }: { url: string }) => <span data-testid="link">{url}</span>,
}));
vi.mock("@/components/BbCodeSpoiler", () => ({
  BbCodeSpoiler: ({
    children,
    title,
  }: {
    children?: React.ReactNode;
    title?: string;
  }) => (
    <span data-testid="spoiler" data-title={title ?? ""}>
      {children}
    </span>
  ),
}));
vi.mock("@/components/CensorBlur", () => ({
  CensorBlur: ({ children }: { children?: React.ReactNode }) => (
    <span data-testid="blur">{children}</span>
  ),
}));

import { renderBbCode } from "./bbcodePlugins";

const renderBb = (text: string, options?: Parameters<typeof renderBbCode>[1]) =>
  render(<div>{renderBbCode(text, options)}</div>);

describe("renderBbCode", () => {
  it("returns null for empty input", () => {
    const { container } = render(<div>{renderBbCode("")}</div>);
    expect(container.querySelector("div")?.firstChild).toBeNull();
  });

  describe("inline formatting tags", () => {
    it("renders bold [b] tags", () => {
      renderBb("[b]bold text[/b]");
      const strong = screen.getByText("bold text");
      expect(strong.tagName).toBe("STRONG");
    });

    it("matches uppercase tag names case-insensitively", () => {
      // bbob preserves the input case for uppercase tags, so [B] renders a
      // native <b> element instead of the styled <strong> from the preset.
      renderBb("[B]BOLD[/B]");
      expect(screen.getByText("BOLD").tagName).toBe("B");
    });

    it("renders italic [i] tags", () => {
      renderBb("[i]italic[/i]");
      expect(screen.getByText("italic").tagName).toBe("EM");
    });

    it("renders underline [u] tags", () => {
      renderBb("[u]underlined[/u]");
      expect(screen.getByText("underlined").tagName).toBe("U");
    });

    it("renders strikethrough [s] tags", () => {
      renderBb("[s]struck[/s]");
      expect(screen.getByText("struck").tagName).toBe("S");
    });

    it("renders line-break [br] tags", () => {
      const { container } = renderBb("a[br]b");
      expect(container.querySelectorAll("br")).toHaveLength(1);
    });

    it("converts newlines to line breaks", () => {
      const { container } = renderBb("line1\nline2");
      expect(container.querySelectorAll("br")).toHaveLength(1);
    });
  });

  describe("color and size tags", () => {
    it("renders [col=red] with the color style", () => {
      renderBb("[col=red]colored[/col]");
      const span = screen.getByText("colored");
      expect(span.tagName).toBe("SPAN");
      expect(span).toHaveStyle({ color: "rgb(255, 0, 0)" });
    });

    it("falls back to inherit when no color is given", () => {
      renderBb("[col]plain[/col]");
      expect(screen.getByText("plain")).toHaveStyle({ color: "inherit" });
    });

    it("renders [size=7] at maximum em size", () => {
      renderBb("[size=7]big[/size]");
      // 0.75 + 6*0.175 yields 1.7999999999999998 in float math
      expect(parseFloat(screen.getByText("big").style.fontSize)).toBeCloseTo(1.8, 2);
    });

    it("renders [size=1] at minimum em size", () => {
      renderBb("[size=1]small[/size]");
      expect(screen.getByText("small")).toHaveStyle({ fontSize: "0.75em" });
    });

    it("clamps oversized values to 7", () => {
      renderBb("[size=99]huge[/size]");
      expect(parseFloat(screen.getByText("huge").style.fontSize)).toBeCloseTo(1.8, 2);
    });

    it("falls back to size 3 for invalid values", () => {
      renderBb("[size=abc]weird[/size]");
      expect(screen.getByText("weird")).toHaveStyle({ fontSize: "1.1em" });
    });
  });

  describe("spoiler and blur tags", () => {
    it("renders a spoiler without title", () => {
      renderBb("[spoiler]secret[/spoiler]");
      const spoiler = screen.getByTestId("spoiler");
      expect(spoiler).toHaveTextContent("secret");
      expect(spoiler).not.toHaveAttribute("data-title", /./);
    });

    it("renders a spoiler with a title attribute", () => {
      renderBb("[spoiler=click me]secret[/spoiler]");
      const spoiler = screen.getByTestId("spoiler");
      expect(spoiler).toHaveTextContent("secret");
      expect(spoiler).toHaveAttribute("data-title", "click me");
    });

    it("renders blur content through CensorBlur", () => {
      renderBb("[blur]hidden content[/blur]");
      expect(screen.getByTestId("blur")).toHaveTextContent("hidden content");
    });

    it("processes markdown inside spoiler content", () => {
      renderBb("[spoiler]**bold secret**[/spoiler]");
      expect(screen.getByTestId("spoiler").querySelector("strong")).not.toBeNull();
    });
  });

  describe("[me] and [dude] tags", () => {
    it("colors [me] with the author color class", () => {
      renderBb("[me]highlighted[/me]", { authorColor: "purple" });
      const el = screen.getByText("highlighted");
      expect(el.className).toContain("text-purple-500");
      expect(el.className).toContain("font-bold");
    });

    it("uses the default quote class for [me] without a known color", () => {
      renderBb("[me]plain[/me]");
      expect(screen.getByText("plain").className).toContain("text-quote");
    });

    it("adds a pointer cursor to [me] when a post author id is present", () => {
      renderBb("[me]mine[/me]", { postAuthorId: "u-42" });
      expect(screen.getByText("mine")).toHaveStyle({ cursor: "pointer" });
    });

    it("colors [dude] with the current user color class", () => {
      renderBb("[dude]you[/dude]", { currentUserColor: "gold" });
      const el = screen.getByText("you");
      expect(el.className).toContain("text-yellow-500");
      expect(el.className).toContain("font-bold");
    });

    it("uses the default quote class for [dude] without a color", () => {
      renderBb("[dude]anon[/dude]");
      expect(screen.getByText("anon").className).toContain("text-quote");
    });
  });

  describe("markdown, emoji, mentions and links", () => {
    it("renders **bold** markdown", () => {
      renderBb("**bold md**");
      expect(screen.getByText("bold md").tagName).toBe("STRONG");
    });

    it("renders *italic* markdown", () => {
      renderBb("*italic md*");
      expect(screen.getByText("italic md").tagName).toBe("EM");
    });

    it("renders ### heading markdown", () => {
      renderBb("### Section");
      expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Section");
    });

    it("renders ## heading markdown", () => {
      renderBb("## Subsection");
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Subsection");
    });

    it("renders - bullet markdown as a list item", () => {
      renderBb("- first item");
      expect(screen.getByRole("listitem")).toHaveTextContent("first item");
    });

    it("passes [e:...] markers through as literal tags (bbob consumes them before the text pass)", () => {
      const { container } = renderBb("check [e:emoji-42]");
      expect(container.innerHTML).toContain("<e:emoji-42>");
    });

    it("renders legacy :code: emoji markers", () => {
      renderBb("legacy :heart:");
      expect(screen.getByTestId("emoji")).toHaveTextContent("heart");
    });

    it("renders @username mentions", () => {
      renderBb("hello @alice");
      expect(screen.getByTestId("mention")).toHaveTextContent("@alice");
    });

    it("renders https URLs as link buttons", () => {
      renderBb("see https://example.com/x");
      expect(screen.getByTestId("link")).toHaveTextContent("https://example.com/x");
    });

    it("mixes plain text, mentions and markdown in one string", () => {
      renderBb("Hi @bob, **important** and *note*");
      expect(screen.getByText(/^Hi/)).toBeInTheDocument();
      expect(screen.getByTestId("mention")).toHaveTextContent("@bob");
      expect(screen.getByText("important").tagName).toBe("STRONG");
      expect(screen.getByText("note").tagName).toBe("EM");
    });
  });
});
