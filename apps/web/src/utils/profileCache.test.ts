import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { profileCache } from "./profileCache";

describe("profileCache", () => {
  beforeEach(() => {
    profileCache.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for missing key", () => {
    expect(profileCache.get("nonexistent")).toBeNull();
  });

  it("stores and retrieves data", () => {
    profileCache.set("user-1", { name: "Alice" });
    expect(profileCache.get("user-1")).toEqual({ name: "Alice" });
  });

  it("returns null after TTL expiry", () => {
    profileCache.set("user-1", { name: "Alice" });
    vi.advanceTimersByTime(61000); // 61 seconds
    expect(profileCache.get("user-1")).toBeNull();
  });

  it("returns data within TTL", () => {
    profileCache.set("user-1", { name: "Alice" });
    vi.advanceTimersByTime(59000); // 59 seconds
    expect(profileCache.get("user-1")).toEqual({ name: "Alice" });
  });

  it("clears entire cache", () => {
    profileCache.set("user-1", { name: "Alice" });
    profileCache.set("user-2", { name: "Bob" });
    profileCache.clear();
    expect(profileCache.get("user-1")).toBeNull();
    expect(profileCache.get("user-2")).toBeNull();
  });

  it("deletes specific key", () => {
    profileCache.set("user-1", { name: "Alice" });
    profileCache.set("user-2", { name: "Bob" });
    profileCache.delete("user-1");
    expect(profileCache.get("user-1")).toBeNull();
    expect(profileCache.get("user-2")).toEqual({ name: "Bob" });
  });

  it("overwrites existing entry", () => {
    profileCache.set("user-1", { name: "Alice" });
    profileCache.set("user-1", { name: "Alice Updated" });
    expect(profileCache.get("user-1")).toEqual({ name: "Alice Updated" });
  });

  it("handles different value types", () => {
    profileCache.set("str", "hello");
    profileCache.set("num", 42);
    profileCache.set("bool", true);
    profileCache.set("arr", [1, 2, 3]);
    expect(profileCache.get("str")).toBe("hello");
    expect(profileCache.get("num")).toBe(42);
    expect(profileCache.get("bool")).toBe(true);
    expect(profileCache.get("arr")).toEqual([1, 2, 3]);
  });
});
