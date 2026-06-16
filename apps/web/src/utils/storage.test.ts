import { describe, it, expect, vi, beforeEach } from "vitest";
import { storageUrl, getPublicUrl, uploadFile, removeFile } from "./storage";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("storageUrl", () => {
  it("returns null for null input", () => {
    expect(storageUrl("bucket", null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(storageUrl("bucket", undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(storageUrl("bucket", "")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(storageUrl("bucket", "  ")).toBeNull();
  });

  it("returns absolute HTTP URL unchanged", () => {
    expect(storageUrl("bucket", "https://example.com/img.jpg")).toBe("https://example.com/img.jpg");
  });

  it("returns absolute HTTP URL unchanged (http)", () => {
    expect(storageUrl("bucket", "http://example.com/img.jpg")).toBe("http://example.com/img.jpg");
  });

  it("prepends API_BASE_URL for relative storage path", () => {
    const result = storageUrl("bucket", "/storage/v1/object/bucket/key.jpg");
    expect(result).toContain("/storage/v1/object/bucket/key.jpg");
  });

  it("constructs URL from key", () => {
    const result = storageUrl("content", "user123/photo.jpg");
    expect(result).toContain("/storage/v1/object/content/");
    expect(result).toContain("user123");
    expect(result).toContain("photo.jpg");
  });

  it("encodes key segments", () => {
    const result = storageUrl("bucket", "path with spaces/file.jpg");
    expect(result).toContain(encodeURIComponent("path with spaces"));
    expect(result).toContain(encodeURIComponent("file.jpg"));
  });

  it("strips leading slashes from key", () => {
    const result = storageUrl("bucket", "/leading/slash.jpg");
    expect(result).not.toContain("//leading");
  });
});

describe("getPublicUrl", () => {
  it("returns object with publicUrl", () => {
    const result = getPublicUrl("bucket", "key.jpg");
    expect(result).toHaveProperty("publicUrl");
    expect(result.publicUrl).toContain("key.jpg");
  });

  it("returns empty string for null key", () => {
    const result = getPublicUrl("bucket", null as any);
    expect(result.publicUrl).toBe("");
  });
});

describe("uploadFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads file and returns path", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

    const result = await uploadFile("content", "user1/file.jpg", file);
    expect(result.path).toBe("user1/file.jpg");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws on upload failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ error: "Server error" }) });
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

    await expect(uploadFile("content", "key", file)).rejects.toThrow("Server error");
  });

  it("includes auth header when token provided", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

    await uploadFile("content", "key", file, "my-token");
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["Authorization"]).toBe("Bearer my-token");
  });

  it("strips leading slashes from key", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

    await uploadFile("content", "/leading/key.jpg", file);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("removeFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes file successfully", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await removeFile("bucket", "key.jpg");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain(encodeURIComponent("bucket"));
    expect(url).toContain(encodeURIComponent("key.jpg"));
  });

  it("does not throw on 404", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    await expect(removeFile("bucket", "missing.jpg")).resolves.toBeUndefined();
  });

  it("throws on other errors", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ error: "fail" }) });
    await expect(removeFile("bucket", "key")).rejects.toThrow("fail");
  });

  it("includes auth header when token provided", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await removeFile("bucket", "key", "token-123");
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["Authorization"]).toBe("Bearer token-123");
  });
});
