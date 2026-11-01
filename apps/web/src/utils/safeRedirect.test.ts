import { describe, expect, it } from "vitest";
import { isSafeRedirect } from "./safeRedirect";

describe("isSafeRedirect", () => {
  it("accepts plain same-origin paths", () => {
    expect(isSafeRedirect("/")).toBe(true);
    expect(isSafeRedirect("/b/general")).toBe(true);
    expect(isSafeRedirect("/profile/42?tab=posts")).toBe(true);
  });

  it("rejects protocol-relative and external URLs", () => {
    expect(isSafeRedirect("//evil.com")).toBe(false);
    expect(isSafeRedirect("//evil.com/login")).toBe(false);
    expect(isSafeRedirect("https://evil.com")).toBe(false);
    expect(isSafeRedirect("http://evil.com")).toBe(false);
    expect(isSafeRedirect("javascript:alert(1)")).toBe(false);
    expect(isSafeRedirect("")).toBe(false);
    expect(isSafeRedirect("relative/path")).toBe(false);
  });

  it("rejects backslash and control-character tricks", () => {
    expect(isSafeRedirect("/\\evil.com")).toBe(false);
    expect(isSafeRedirect("/foo\\bar")).toBe(false);
    expect(isSafeRedirect("/foo\x01bar")).toBe(false);
  });
});
