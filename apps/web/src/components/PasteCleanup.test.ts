import { describe, it, expect } from "vitest";
import { stripForeignStyles, cleanPastedHtml } from "./PasteCleanup";

describe("stripForeignStyles", () => {
  it("keeps the app's own color and font-size marks", () => {
    const result = stripForeignStyles("color: #ff0000; font-size: 18px");
    expect(result).toContain("color: #ff0000");
    expect(result).toContain("font-size: 18px");
  });

  it("strips font-family, background and mso noise", () => {
    expect(stripForeignStyles("font-family: Arial; background-color: #fff")).toBe("");
    expect(stripForeignStyles("mso-ansi-font-size: 12.0pt; -ms-text-size-adjust: 100%")).toBe("");
  });

  it("keeps allowed props and drops foreign ones in one pass", () => {
    const result = stripForeignStyles(
      "color: rgb(1,2,3); line-height: 24px; font-weight: bold; mso-hide: all; font-size: 14px"
    );
    expect(result).toContain("color: rgb(1,2,3)");
    expect(result).toContain("font-size: 14px");
    expect(result).not.toContain("line-height");
    expect(result).not.toContain("font-weight");
    expect(result).not.toContain("mso-");
  });
});

describe("cleanPastedHtml", () => {
  it("removes Word/Outlook junk elements and Mso classes", () => {
    const html = `<div><o:p></o:p><p class="MsoNormal" style="mso-hide:all">Hello</p></div>`;
    const result = cleanPastedHtml(html);
    expect(result).not.toContain("o:p");
    expect(result).not.toContain("MsoNormal");
    expect(result).toContain("Hello");
  });

  it("keeps our spoiler attributes while dropping the foreign background-color", () => {
    const html = `<span data-spoiler="" style="filter:blur(6px);background-color:#fff">Secret</span>`;
    const result = cleanPastedHtml(html);
    expect(result).toContain("data-spoiler");
    expect(result).toContain("filter:blur(6px)");
    expect(result).not.toContain("background-color");
  });

  it("keeps color/font-size but strips font-family", () => {
    const html = `<span style="color:#ff0000;font-size:18px;font-family:Arial">Red</span>`;
    const result = cleanPastedHtml(html);
    expect(result).toContain("color:#ff0000");
    expect(result).toContain("font-size:18px");
    expect(result).not.toContain("font-family");
  });

  it("does not treat mid-word # as a hashtag target (PasteCleanup is style-only)", () => {
    const html = `<p>see site.com/#news and foo#bar</p>`;
    const result = cleanPastedHtml(html);
    expect(result).toContain("site.com/#news");
    expect(result).toContain("foo#bar");
  });
});
