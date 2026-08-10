import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getCurrentUserMeta, getGiftCatalog, clearCurrentUserMetaCache } from "./currentUserMeta";

// vi.mock calls are hoisted above declarations, so the mock fns must live in
// vi.hoisted to be referenced from the factory.
const mocks = vi.hoisted(() => ({
  mockAuth: { getSession: vi.fn(), getUser: vi.fn(), onAuthStateChange: vi.fn() },
  mockFetch: vi.fn(),
}));

vi.mock("@/integrations/api/compat", () => ({
  api: { from: vi.fn(), rpc: vi.fn(), auth: mocks.mockAuth },
}));

// GiftCard is only imported for its type — keep the module resolvable.
vi.mock("@/components/GiftCard", () => ({ GiftCard: () => null }));

vi.stubGlobal("fetch", mocks.mockFetch);

const session = { user: { id: "user-1" }, access_token: "token-abc" };

function mockMetaResponses() {
  mocks.mockFetch.mockImplementation((url: string) => {
    if (url.includes("/api/v1/user_roles")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ role: "admin" }] }) });
    }
    if (url.includes("/api/v1/profiles")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: "user-1", username: "alice", avatar_url: "/a.png", nickname_emoji_id: "emoji-1" }],
          }),
      });
    }
    if (url.includes("/api/v1/user_achievements")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { achievements: { reward_type: "username_color", reward_value: "gold" } },
              { achievements: { reward_type: "username_color", reward_value: "purple" } },
            ],
          }),
      });
    }
    if (url.includes("/api/v1/gift_catalog")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: "g1", name: "Rose", price: 10, category: "flowers" }],
          }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
  });
}

describe("getCurrentUserMeta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCurrentUserMetaCache();
    mocks.mockAuth.getSession.mockResolvedValue({ data: { session }, error: null });
    mockMetaResponses();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns roles, color, username, avatar and nickname emoji in one batched call", async () => {
    const meta = await getCurrentUserMeta("user-1");

    expect(meta.roles).toEqual(["admin"]);
    expect(meta.color).toBe("purple"); // priority order starts with purple, then gold
    expect(meta.username).toBe("alice");
    expect(meta.avatarUrl).toBe("/a.png");
    expect(meta.nicknameEmojiId).toBe("emoji-1");
    expect(mocks.mockFetch).toHaveBeenCalledTimes(3);
  });

  it("caches the result — a second call fires zero requests", async () => {
    await getCurrentUserMeta("user-1");
    const callsAfterFirst = mocks.mockFetch.mock.calls.length;

    await getCurrentUserMeta("user-1");
    expect(mocks.mockFetch.mock.calls.length).toBe(callsAfterFirst);
  });

  it("deduplicates concurrent calls", async () => {
    await Promise.all([getCurrentUserMeta("user-1"), getCurrentUserMeta("user-1"), getCurrentUserMeta("user-1")]);
    // 3 parallel calls → only 3 fetches total (one roles + one profiles + one achievements)
    expect(mocks.mockFetch.mock.calls.length).toBe(3);
  });

  it("returns empty meta without a userId", async () => {
    const meta = await getCurrentUserMeta(undefined);
    expect(meta.roles).toEqual([]);
    expect(meta.color).toBe("");
    expect(mocks.mockFetch).not.toHaveBeenCalled();
  });

  it("clears the cache when the profile-cache:invalidate event fires", async () => {
    await getCurrentUserMeta("user-1");
    const callsAfterFirst = mocks.mockFetch.mock.calls.length;

    // Simulate a profile mutation (username/avatar/emoji change): all listeners
    // must reset their caches so the next read refetches.
    window.dispatchEvent(new CustomEvent("profile-cache:invalidate"));

    await getCurrentUserMeta("user-1");
    expect(mocks.mockFetch.mock.calls.length).toBe(callsAfterFirst + 3);
  });
});

describe("getGiftCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCurrentUserMetaCache();
    mockMetaResponses();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the catalog once and reuses it within the TTL", async () => {
    const first = await getGiftCatalog();
    expect(first).toHaveLength(1);

    await getGiftCatalog();
    await getGiftCatalog();

    const catalogCalls = mocks.mockFetch.mock.calls.filter((c: unknown[]) => String(c[0]).includes("/api/v1/gift_catalog"));
    expect(catalogCalls).toHaveLength(1);
  });
});
