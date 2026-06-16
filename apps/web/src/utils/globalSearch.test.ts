import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchGlobal } from "./globalSearch";

const mockRawRequest = vi.fn();
vi.mock("@/integrations/api/client", () => ({
  apiClient: {
    rawRequest: (...args: any[]) => mockRawRequest(...args),
  },
}));

describe("searchGlobal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty results for short query", async () => {
    const result = await searchGlobal("a");
    expect(result).toEqual({ users: [], boards: [], threads: [], posts: [] });
    expect(mockRawRequest).not.toHaveBeenCalled();
  });

  it("returns empty results for empty query", async () => {
    const result = await searchGlobal("");
    expect(result).toEqual({ users: [], boards: [], threads: [], posts: [] });
  });

  it("returns empty results for whitespace-only query", async () => {
    const result = await searchGlobal("   ");
    expect(result).toEqual({ users: [], boards: [], threads: [], posts: [] });
  });

  it("fetches search results for valid query", async () => {
    mockRawRequest.mockResolvedValue({
      success: true,
      data: {
        users: [{ id: "u1", username: "alice" }],
        boards: [{ id: "b1", slug: "general", name: "General" }],
        threads: [{ id: "t1", title: "Hello", content: "World", created_at: "", updated_at: "", board_id: "b1", board_slug: "general", board_name: "General" }],
        posts: [],
      },
    });

    const result = await searchGlobal("hello");
    expect(result.users).toHaveLength(1);
    expect(result.boards).toHaveLength(1);
    expect(result.threads).toHaveLength(1);
  });

  it("returns empty on API failure", async () => {
    mockRawRequest.mockRejectedValue(new Error("Network error"));
    const result = await searchGlobal("test");
    expect(result).toEqual({ users: [], boards: [], threads: [], posts: [] });
  });

  it("returns empty when response not successful", async () => {
    mockRawRequest.mockResolvedValue({ success: false, data: null });
    const result = await searchGlobal("test");
    expect(result).toEqual({ users: [], boards: [], threads: [], posts: [] });
  });

  it("applies limits correctly", async () => {
    mockRawRequest.mockResolvedValue({
      success: true,
      data: {
        users: Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, username: `user${i}` })),
        boards: [],
        threads: [],
        posts: [],
      },
    });

    const result = await searchGlobal("test", { users: 5 });
    expect(result.users).toHaveLength(5);
  });

  it("uses default limits when not provided", async () => {
    mockRawRequest.mockResolvedValue({
      success: true,
      data: {
        users: Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, username: `user${i}` })),
        boards: [],
        threads: [],
        posts: [],
      },
    });

    const result = await searchGlobal("test");
    expect(result.users).toHaveLength(8);
  });

  it("normalises thread data correctly", async () => {
    mockRawRequest.mockResolvedValue({
      success: true,
      data: {
        threads: [{ id: "t1", title: "T", content: "C", created_at: "2025", updated_at: "2025", board_id: "b1", board_slug: "slug", board_name: "Name", board_is_gomosub: true }],
      },
    });

    const result = await searchGlobal("test");
    expect(result.threads[0].board_is_gomosub).toBe(true);
  });
});
