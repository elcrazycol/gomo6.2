import { describe, it, expect, vi } from "vitest";
import {
  normalizeWallPostAuthor,
  normalizeWallPostRecord,
  normalizeWallComment,
  getWallPostPath,
  isInteractiveTarget,
  normalizeAttachments,
  type WallPost,
} from "./wallNormalizers";

vi.mock("@/utils/lexicalContent", () => ({
  lexicalJsonToPlainText: (json: unknown, fallback: string) => {
    if (!json || typeof json !== "object") return fallback;
    const root = (json as any).root;
    if (root?.children?.[0]?.children?.[0]?.text) {
      return root.children[0].children[0].text;
    }
    return fallback;
  },
}));

vi.mock("@/utils/safeDate", () => ({
  safeDate: (d: string) => new Date(d),
}));

function makePost(overrides: Partial<WallPost> = {}): WallPost {
  return {
    id: "post-1",
    user_id: "user-1",
    author_id: "author-1",
    content: "Hello",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    author: { username: "testuser", is_anonymous: false },
    ...overrides,
  };
}

describe("normalizeWallPostAuthor", () => {
  it("extracts author from object", () => {
    const result = normalizeWallPostAuthor({ username: "alice", is_anonymous: false, avatar_url: "av.jpg" });
    expect(result).toEqual({ username: "alice", is_anonymous: false, avatar_url: "av.jpg" });
  });

  it("extracts author from array (takes first element)", () => {
    const result = normalizeWallPostAuthor([{ username: "bob", is_anonymous: true }]);
    expect(result).toEqual({ username: "bob", is_anonymous: true, avatar_url: null });
  });

  it("returns fallback when author is null", () => {
    const result = normalizeWallPostAuthor(null, "fallback_user");
    expect(result).toEqual({ username: "fallback_user", is_anonymous: false, avatar_url: null });
  });

  it("returns 'user' when author is null and no fallback", () => {
    const result = normalizeWallPostAuthor(null);
    expect(result).toEqual({ username: "user", is_anonymous: false, avatar_url: null });
  });

  it("returns fallback for non-object author", () => {
    const result = normalizeWallPostAuthor("string", "fallback");
    expect(result).toEqual({ username: "fallback", is_anonymous: false, avatar_url: null });
  });

  it("returns null avatar_url when avatar_url is falsy", () => {
    const result = normalizeWallPostAuthor({ username: "u", is_anonymous: false, avatar_url: "" });
    expect(result.avatar_url).toBeNull();
  });

  it("returns undefined author as fallback", () => {
    const result = normalizeWallPostAuthor(undefined, "def_user");
    expect(result.username).toBe("def_user");
  });
});

describe("normalizeWallPostRecord", () => {
  it("normalizes basic post record", () => {
    const post = {
      id: "p1",
      user_id: "u1",
      author_id: "a1",
      content: "hi",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
      author: { username: "carol", is_anonymous: false },
    };
    const result = normalizeWallPostRecord(post);
    expect(result.author.username).toBe("carol");
    expect(result.repost_of_post_id).toBeNull();
    expect(result.original_post).toBeNull();
  });

  it("preserves repost_of_post_id", () => {
    const post = {
      id: "p1",
      user_id: "u1",
      author: { username: "u", is_anonymous: false },
      repost_of_post_id: "orig-1",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    };
    const result = normalizeWallPostRecord(post);
    expect(result.repost_of_post_id).toBe("orig-1");
  });

  it("normalizes nested original_post", () => {
    const post = {
      id: "p1",
      user_id: "u1",
      author: { username: "u", is_anonymous: false },
      original_post: {
        id: "orig-1",
        user_id: "u2",
        content: "original",
        author: { username: "dan", is_anonymous: false },
      },
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    };
    const result = normalizeWallPostRecord(post);
    expect(result.original_post).not.toBeNull();
    expect(result.original_post!.author.username).toBe("dan");
    expect(result.original_post!.repost_of_post_id).toBeNull();
  });

  it("uses currentUsername when author is missing", () => {
    const post = {
      id: "p1",
      user_id: "u1",
      author: null,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    };
    const result = normalizeWallPostRecord(post, "fallback_name");
    expect(result.author.username).toBe("fallback_name");
  });
});

describe("normalizeWallComment", () => {
  it("uses content string when available", () => {
    const comment = {
      id: "c1",
      post_id: "p1",
      user_id: "u1",
      content: "Nice post!",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
      author: { username: "eve", is_anonymous: false },
    };
    const result = normalizeWallComment(comment);
    expect(result.content).toBe("Nice post!");
  });

  it("falls back to content_json when content is empty", () => {
    const comment = {
      id: "c1",
      post_id: "p1",
      user_id: "u1",
      content: "",
      content_json: { root: { children: [{ children: [{ text: "from json" }] }] } },
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
      author: { username: "eve", is_anonymous: false },
    };
    const result = normalizeWallComment(comment);
    expect(result.content).toBe("from json");
  });

  it("uses default date when timestamps missing", () => {
    const comment = {
      id: "c1",
      post_id: "p1",
      user_id: "u1",
      content: "hi",
      author: { username: "u", is_anonymous: false },
    };
    const result = normalizeWallComment(comment);
    expect(result.created_at).toBeTruthy();
    expect(result.updated_at).toBeTruthy();
  });
});

describe("getWallPostPath", () => {
  it("generates correct path", () => {
    expect(getWallPostPath("user-1", "post-1")).toBe("/profile/user-1/wall/post-1");
  });
});

describe("isInteractiveTarget", () => {
  it("returns false for non-HTMLElement", () => {
    expect(isInteractiveTarget(null)).toBe(false);
    expect(isInteractiveTarget("string" as unknown as EventTarget)).toBe(false);
  });

  it("returns true for button inside container", () => {
    const container = document.createElement("div");
    const btn = document.createElement("button");
    container.appendChild(btn);
    expect(isInteractiveTarget(btn)).toBe(true);
  });

  it("returns true for anchor", () => {
    const a = document.createElement("a");
    expect(isInteractiveTarget(a)).toBe(true);
  });

  it("returns true for input", () => {
    const input = document.createElement("input");
    expect(isInteractiveTarget(input)).toBe(true);
  });

  it("returns false when interactive element equals currentTarget", () => {
    const btn = document.createElement("button");
    expect(isInteractiveTarget(btn, btn)).toBe(false);
  });

  it("returns false for plain div", () => {
    const div = document.createElement("div");
    expect(isInteractiveTarget(div)).toBe(false);
  });

  it("returns true for element with role=button", () => {
    const div = document.createElement("div");
    div.setAttribute("role", "button");
    expect(isInteractiveTarget(div)).toBe(true);
  });
});

describe("normalizeAttachments", () => {
  it("returns attachments array when present", () => {
    const attachments = [{ url: "file.pdf", type: "file" as const, mime: "application/pdf", name: "doc", size: 100 }];
    const post = makePost({ attachments });
    expect(normalizeAttachments(post)).toEqual(attachments);
  });

  it("creates image attachment from image_url when no attachments", () => {
    const post = makePost({ image_url: "photo.jpg" });
    const result = normalizeAttachments(post);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("photo.jpg");
    expect(result[0].type).toBe("image");
  });

  it("returns empty array when no attachments and no image_url", () => {
    const post = makePost();
    expect(normalizeAttachments(post)).toEqual([]);
  });

  it("returns empty array for empty attachments array", () => {
    const post = makePost({ attachments: [] });
    expect(normalizeAttachments(post)).toEqual([]);
  });
});
