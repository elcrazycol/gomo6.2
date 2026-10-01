import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useFriendsStore, type Friend, type SubscriptionUser } from "./friendsStore";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));
vi.mock("@/integrations/api/compat", () => ({
  api: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as unknown as Response;
}

const friend: Friend = {
  friendship_id: "fs-1",
  user_id: "u-2",
  username: "bob",
  display_name: "Bob",
  is_online: true,
};

const subscriber: SubscriptionUser = {
  user_id: "u-2",
  username: "bob",
  display_name: "Bob",
  is_online: true,
  is_friend: false,
  subscribed_at: new Date().toISOString(),
};

describe("friendsStore", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "u-1" }, access_token: "token-abc" } },
      error: null,
    });
    vi.stubGlobal("fetch", fetchMock);
    useFriendsStore.setState({
      friends: [],
      profileFriends: [],
      profileSubscribers: [],
      profileSubscriptions: [],
      friendStatusMap: {},
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has correct initial state", () => {
    const state = useFriendsStore.getState();
    expect(state.friends).toEqual([]);
    expect(state.profileFriends).toEqual([]);
    expect(state.profileSubscribers).toEqual([]);
    expect(state.profileSubscriptions).toEqual([]);
    expect(state.friendStatusMap).toEqual({});
    expect(state.isLoading).toBe(false);
  });

  it("fetchFriends loads friends and attaches the auth header", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [friend] }));

    await useFriendsStore.getState().fetchFriends();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/friends",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-abc",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(useFriendsStore.getState().friends).toEqual([friend]);
    expect(useFriendsStore.getState().isLoading).toBe(false);
  });

  it("fetchProfileSubscribers loads subscribers for a specific user", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [subscriber] }));

    await useFriendsStore.getState().fetchProfileSubscribers("u-2");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/friends/subscribers?user_id=u-2",
      expect.anything(),
    );
    expect(useFriendsStore.getState().profileSubscribers).toEqual([subscriber]);
  });

  it("fetchProfileSubscriptions loads subscriptions for a specific user", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [subscriber] }));

    await useFriendsStore.getState().fetchProfileSubscriptions("u-2");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/friends/subscriptions?user_id=u-2",
      expect.anything(),
    );
    expect(useFriendsStore.getState().profileSubscriptions).toEqual([subscriber]);
  });

  it("fetchProfileSubscribers skips the request for guests", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await useFriendsStore.getState().fetchProfileSubscribers("u-2");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useFriendsStore.getState().profileSubscribers).toEqual([]);
  });

  it("subscribe marks subscribed and stays on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { status: "subscribed" } }));

    await useFriendsStore.getState().subscribe("u-2");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/friends/subscribe",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ user_id: "u-2" }),
      }),
    );
    expect(useFriendsStore.getState().friendStatusMap["u-2"].status).toBe("subscribed");
  });

  it("subscribe becomes friends and refreshes when mutual", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { status: "friends", became_friends: true } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: [friend] }));

    await useFriendsStore.getState().subscribe("u-2");

    await vi.waitFor(() => {
      expect(useFriendsStore.getState().friends).toEqual([friend]);
    });
    expect(useFriendsStore.getState().friendStatusMap["u-2"]).toEqual({
      status: "friends",
      followsYou: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // POST + refresh
  });

  it("subscribe rolls back the optimistic status on failure", async () => {
    useFriendsStore.setState({ friendStatusMap: { "u-2": { status: "none" } } });
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "denied" }));

    await expect(useFriendsStore.getState().subscribe("u-2")).rejects.toThrow("denied");

    expect(useFriendsStore.getState().friendStatusMap["u-2"].status).toBe("none");
  });

  it("subscribe removes the status entry when there was no previous status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "denied" }));

    await expect(useFriendsStore.getState().subscribe("u-9")).rejects.toThrow("denied");

    expect(useFriendsStore.getState().friendStatusMap["u-9"]).toBeUndefined();
  });

  it("unsubscribe removes the friend and sets status none", async () => {
    useFriendsStore.setState({
      friends: [friend],
      friendStatusMap: { "u-2": { status: "friends", followsYou: true } },
    });
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));

    await useFriendsStore.getState().unsubscribe("u-2");

    expect(useFriendsStore.getState().friends).toEqual([]);
    expect(useFriendsStore.getState().friendStatusMap["u-2"].status).toBe("none");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/friends/subscribe/u-2",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("unsubscribe restores the previous state on failure", async () => {
    useFriendsStore.setState({
      friends: [friend],
      friendStatusMap: { "u-2": { status: "friends", followsYou: true } },
    });
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "boom" }));

    await expect(useFriendsStore.getState().unsubscribe("u-2")).rejects.toThrow("boom");

    expect(useFriendsStore.getState().friends).toEqual([friend]);
    expect(useFriendsStore.getState().friendStatusMap["u-2"]).toEqual({
      status: "friends",
      followsYou: true,
    });
  });

  it("checkStatus stores the server status and follows_you flag", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { status: "subscribed", follows_you: true } }),
    );

    const status = await useFriendsStore.getState().checkStatus("u-2");

    expect(status).toBe("subscribed");
    expect(useFriendsStore.getState().friendStatusMap["u-2"]).toEqual({
      status: "subscribed",
      followsYou: true,
    });
  });

  it("checkStatus returns none on failure", async () => {
    fetchMock.mockRejectedValue(new Error("network"));

    const status = await useFriendsStore.getState().checkStatus("u-2");

    expect(status).toBe("none");
  });

  it("setStatus writes the map directly", () => {
    useFriendsStore.getState().setStatus("u-2", "subscribed", false);

    expect(useFriendsStore.getState().friendStatusMap["u-2"]).toEqual({
      status: "subscribed",
      followsYou: false,
    });
  });
});
