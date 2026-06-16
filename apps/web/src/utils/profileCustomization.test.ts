import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseCssToStyle, getProfileCustomization, clearCustomizationCache } from "./profileCustomization";

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

describe("parseCssToStyle", () => {
  it("returns empty object for empty string", () => {
    expect(parseCssToStyle("")).toEqual({});
  });

  it("parses single color declaration", () => {
    expect(parseCssToStyle("color: red")).toEqual({ color: "red" });
  });

  it("parses multiple declarations", () => {
    const result = parseCssToStyle("color: blue; font-weight: bold");
    expect(result).toEqual({ color: "blue", fontWeight: "bold" });
  });

  it("converts kebab-case to camelCase", () => {
    expect(parseCssToStyle("font-size: 14px")).toEqual({ fontSize: "14px" });
  });

  it("handles webkit prefix", () => {
    const result = parseCssToStyle("-webkit-background-clip: text");
    expect(result).toEqual({ WebkitBackgroundClip: "text" });
  });

  it("handles webkit-text-fill-color", () => {
    const result = parseCssToStyle("-webkit-text-fill-color: transparent");
    expect(result).toEqual({ WebkitTextFillColor: "transparent" });
  });

  it("handles text-shadow", () => {
    const result = parseCssToStyle("text-shadow: 0 0 5px red");
    expect(result).toEqual({ textShadow: "0 0 5px red" });
  });

  it("handles box-shadow", () => {
    const result = parseCssToStyle("box-shadow: 0 2px 4px rgba(0,0,0,0.1)");
    expect(result).toEqual({ boxShadow: "0 2px 4px rgba(0,0,0,0.1)" });
  });

  it("handles background-image", () => {
    const result = parseCssToStyle("background-image: linear-gradient(red, blue)");
    expect(result).toEqual({ backgroundImage: "linear-gradient(red, blue)" });
  });

  it("handles background-color", () => {
    const result = parseCssToStyle("background-color: #fff");
    expect(result).toEqual({ backgroundColor: "#fff" });
  });

  it("handles border-radius", () => {
    const result = parseCssToStyle("border-radius: 8px");
    expect(result).toEqual({ borderRadius: "8px" });
  });

  it("skips declarations without colon", () => {
    expect(parseCssToStyle("invalid-no-colon")).toEqual({});
  });

  it("skips declarations with empty property or value", () => {
    expect(parseCssToStyle(": value; property:")).toEqual({});
  });

  it("handles values containing colons (e.g. rgba)", () => {
    const result = parseCssToStyle("background: rgba(0, 0, 0, 0.5)");
    expect(result).toEqual({ background: "rgba(0, 0, 0, 0.5)" });
  });
});

describe("getProfileCustomization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCustomizationCache();
  });

  it("fetches customization from API", async () => {
    const mockData = { username_css: "color: red", username_icon_svg: null, username_icon_fill: null, username_icon_stroke: null, profile_badge_text: "VIP", profile_badge_css: null };
    mockFrom.mockReturnValue(makeChain({ data: mockData, error: null }));

    const result = await getProfileCustomization("user-1");
    expect(result).toEqual(mockData);
  });

  it("returns null when no data found", async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));

    const result = await getProfileCustomization("user-1");
    expect(result).toBeNull();
  });

  it("caches result on subsequent calls", async () => {
    const mockData = { username_css: "color: blue", username_icon_svg: null, username_icon_fill: null, username_icon_stroke: null, profile_badge_text: null, profile_badge_css: null };
    mockFrom.mockReturnValue(makeChain({ data: mockData, error: null }));

    await getProfileCustomization("user-1");
    await getProfileCustomization("user-1");

    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("returns null on API error", async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { code: "42P01", message: "error" } }));

    const result = await getProfileCustomization("user-1");
    expect(result).toBeNull();
  });
});

describe("clearCustomizationCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCustomizationCache();
  });

  it("clears specific user from cache", async () => {
    mockFrom.mockReturnValue(makeChain({ data: { username_css: null, username_icon_svg: null, username_icon_fill: null, username_icon_stroke: null, profile_badge_text: null, profile_badge_css: null }, error: null }));

    await getProfileCustomization("user-1");
    clearCustomizationCache("user-1");
    await getProfileCustomization("user-1");

    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it("clears entire cache when no userId", async () => {
    mockFrom.mockReturnValue(makeChain({ data: { username_css: null, username_icon_svg: null, username_icon_fill: null, username_icon_stroke: null, profile_badge_text: null, profile_badge_css: null }, error: null }));

    await getProfileCustomization("user-1");
    clearCustomizationCache();
    await getProfileCustomization("user-1");

    expect(mockFrom).toHaveBeenCalledTimes(2);
  });
});
