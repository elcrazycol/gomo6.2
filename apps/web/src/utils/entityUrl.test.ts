import { describe, it, expect } from "vitest";
import { entityParam, isPublicId, profileUrl, threadUrl, wallPostUrl } from "./entityUrl";

describe("isPublicId", () => {
  it("accepts the numbers the backend allocates", () => {
    expect(isPublicId("10")).toBe(true);
    expect(isPublicId("100")).toBe(true);
    expect(isPublicId("1337")).toBe(true);
  });

  it("rejects UUIDs, leading zeros and junk", () => {
    for (const value of ["", "0", "0123", "42a", "20d1f4de-8094-44af-ac52-56247311b7d8", null, undefined]) {
      expect(isPublicId(value as string | null | undefined)).toBe(false);
    }
  });
});

describe("entityParam", () => {
  it("prefers the public number", () => {
    expect(entityParam({ id: "uuid-1", public_id: 42 })).toBe("42");
  });

  it("falls back to the UUID for cached payloads without a number", () => {
    expect(entityParam({ id: "uuid-1" })).toBe("uuid-1");
    expect(entityParam({ id: "uuid-1", public_id: null })).toBe("uuid-1");
    expect(entityParam({ id: "uuid-1", public_id: undefined })).toBe("uuid-1");
  });

  it("ignores a non-finite number", () => {
    expect(entityParam({ id: "uuid-1", public_id: Number.NaN })).toBe("uuid-1");
    expect(entityParam({ id: "uuid-1", public_id: Infinity })).toBe("uuid-1");
  });

  it("returns an empty string when there is nothing to address", () => {
    expect(entityParam(null)).toBe("");
    expect(entityParam(undefined)).toBe("");
    expect(entityParam({})).toBe("");
  });
});

describe("link builders", () => {
  it("builds profile links from numbers, with a UUID fallback", () => {
    expect(profileUrl({ id: "uuid-1", public_id: 10 })).toBe("/profile/10");
    expect(profileUrl({ id: "uuid-1" })).toBe("/profile/uuid-1");
  });

  it("builds global-topic thread links", () => {
    expect(threadUrl({ id: "uuid-t", public_id: 315 })).toBe("/thread/315");
    expect(threadUrl({ id: "uuid-t" })).toBe("/thread/uuid-t");
  });

  it("builds board-scoped thread links when a slug is known", () => {
    expect(threadUrl({ id: "uuid-t", public_id: 315 }, { slug: "general" })).toBe("/g/general/thread/315");
    expect(threadUrl({ id: "uuid-t" }, { slug: "general" })).toBe("/g/general/thread/uuid-t");
  });

  it("builds wall post links from both numbers", () => {
    expect(wallPostUrl({ id: "u", public_id: 42 }, { id: "p", public_id: 1337 })).toBe(
      "/profile/42/wall/1337",
    );
  });

  it("never emits a half-built URL", () => {
    expect(wallPostUrl({ id: "u", public_id: 42 }, null)).toBe("");
    expect(wallPostUrl(null, { id: "p", public_id: 1337 })).toBe("");
    expect(profileUrl(null)).toBe("");
    expect(threadUrl(null)).toBe("");
  });
});
