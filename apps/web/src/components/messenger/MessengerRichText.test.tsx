import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessengerRichText } from "./MessengerRichText";

vi.mock("@/components/EmojiInline", () => ({
  EmojiInline: ({ emojiId }: { emojiId?: string }) => (
    <span data-testid="emoji-inline">{emojiId}</span>
  ),
}));

describe("MessengerRichText", () => {
  it("renders plain text as-is", () => {
    render(<MessengerRichText text="just text" />);
    expect(screen.getByText("just text")).toBeInTheDocument();
  });

  it("renders bold / italic / underline / strike", () => {
    render(<MessengerRichText text="[b]bold[/b] [i]it[/i] [u]un[/u] [s]st[/s]" />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("it").tagName).toBe("EM");
    expect(screen.getByText("un").tagName).toBe("U");
    expect(screen.getByText("st").tagName).toBe("S");
  });

  it("renders color and size spans", () => {
    const { container } = render(<MessengerRichText text="[col=#ff0000]red[/col] [size=3]big[/size]" />);
    expect(container.querySelector('span[style*="color: rgb(255, 0, 0)"]')?.textContent).toBe("red");
    expect(container.querySelector('span[style*="font-size: 18px"]')?.textContent).toBe("big");
  });

  it("renders emoji tokens through EmojiInline", () => {
    render(<MessengerRichText text="hi [e:abc-123] there" />);
    const emojis = screen.getAllByTestId("emoji-inline");
    expect(emojis).toHaveLength(1);
    expect(emojis[0]).toHaveTextContent("abc-123");
  });

  it("renders blur as a revealable spoiler", () => {
    const { container } = render(<MessengerRichText text="[blur]secret[/blur]" />);
    expect(container.querySelector(".CensorSpoiler")).toBeInTheDocument();
    expect(container.querySelector(".CensorSpoiler")).toHaveTextContent("secret");
  });

  it("renders [spoiler] with a title button", () => {
    render(<MessengerRichText text="[spoiler=Сюрприз]hidden[/spoiler]" />);
    expect(screen.getByText("Сюрприз")).toBeInTheDocument();
  });

  it("renders [url=…] as a safe external link", () => {
    render(<MessengerRichText text="[url=https://gomo6.wtf]go[/url]" />);
    const link = screen.getByText("go").closest("a");
    expect(link).toHaveAttribute("href", "https://gomo6.wtf");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("does not link javascript: URLs", () => {
    render(<MessengerRichText text="[url=javascript:alert(1)]x[/url]" />);
    expect(screen.getByText("x").closest("a")).toBeNull();
  });

  it("renders nested tags", () => {
    const { container } = render(<MessengerRichText text="[b][col=#00ff00]green bold[/col][/b]" />);
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.querySelector('span[style*="color: rgb(0, 255, 0)"]')).not.toBeNull();
  });

  it("renders raw external URLs as links", () => {
    render(<MessengerRichText text="see https://example.com/page now" />);
    const link = screen.getByText("https://example.com/page", { exact: false });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://example.com/page");
  });

  it("keeps unknown and unclosed tags as literal text", () => {
    render(<MessengerRichText text="a [quote]x[/quote] and [b]open" />);
    expect(screen.getByText(/\[quote\]x\[\/quote\]/)).toBeInTheDocument();
    expect(screen.getByText(/\[b\]open/)).toBeInTheDocument();
  });

  it("keeps plain text with special chars intact", () => {
    render(<MessengerRichText text="a < b & c > d" />);
    expect(screen.getByText("a < b & c > d")).toBeInTheDocument();
  });
});
