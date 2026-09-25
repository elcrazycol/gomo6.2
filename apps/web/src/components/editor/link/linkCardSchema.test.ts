import { describe, expect, it } from "vitest";
import { isCardableUrl, linkHost, toLinkCardAttrs } from "./linkCardSchema";

describe("linkCardSchema", () => {
  it("accepts only http/https urls", () => {
    expect(isCardableUrl("https://example.com")).toBe(true);
    expect(isCardableUrl("http://example.com/x?y=1")).toBe(true);
    expect(isCardableUrl("ftp://example.com")).toBe(false);
    expect(isCardableUrl("javascript:alert(1)")).toBe(false);
    expect(isCardableUrl("just text")).toBe(false);
  });

  it("derives a display host without www", () => {
    expect(linkHost("https://www.example.com/a/b")).toBe("example.com");
    expect(linkHost("https://example.com")).toBe("example.com");
    expect(linkHost("not a url")).toBe("not a url");
  });

  it("coerces node attrs safely", () => {
    expect(
      toLinkCardAttrs({ url: "https://x", title: "T", description: 3, image: "", siteName: "S" }),
    ).toEqual({ url: "https://x", title: "T", description: "", image: null, siteName: "S" });
    expect(toLinkCardAttrs(null)).toEqual({ url: "", title: "", description: "", image: null, siteName: "" });
  });
});
