import { describe, it, expect } from "vitest";
import { buildShareToken, parseShareToken, SHARE_TOKEN_PREFIX } from "./share";

describe("buildShareToken", () => {
  it("builds a thread token", () => {
    expect(buildShareToken({ type: "thread", id: "t-123" })).toBe("__SHARE__:thread:t-123");
  });

  it("builds a wall token", () => {
    expect(buildShareToken({ type: "wall", id: "w-456" })).toBe("__SHARE__:wall:w-456");
  });

  it("prefixes with the share constant", () => {
    expect(buildShareToken({ type: "thread", id: "t-1" })).toContain(SHARE_TOKEN_PREFIX);
  });
});

describe("parseShareToken", () => {
  it("parses a valid thread token", () => {
    expect(parseShareToken("__SHARE__:thread:t-123")).toEqual({ type: "thread", id: "t-123" });
  });

  it("parses a valid wall token", () => {
    expect(parseShareToken("__SHARE__:wall:w-456")).toEqual({ type: "wall", id: "w-456" });
  });

  it("parses UUID ids", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseShareToken(`__SHARE__:thread:${id}`)).toEqual({ type: "thread", id });
  });

  it("returns null for plain text", () => {
    expect(parseShareToken("hello world")).toBeNull();
    expect(parseShareToken("")).toBeNull();
  });

  it("returns null when the token is not at the start", () => {
    expect(parseShareToken("смотри __SHARE__:thread:t-1")).toBeNull();
    expect(parseShareToken("__SHARE__:thread:t-1 потом текст")).toBeNull();
  });

  it("returns null for unknown types", () => {
    expect(parseShareToken("__SHARE__:post:t-1")).toBeNull();
  });

  it("returns null for truncated tokens", () => {
    expect(parseShareToken("__SHARE__:thread")).toBeNull();
    expect(parseShareToken("__SHARE__:")).toBeNull();
    expect(parseShareToken("__SHARE__")).toBeNull();
  });
});
