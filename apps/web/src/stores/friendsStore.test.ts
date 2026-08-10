import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useFriendsStore, type Friend, type FriendRequest } from "./friendsStore";

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

const request: FriendRequest = {
  id: "req-1",
  sender_id: "u-2",
  sender_username: "bob",
  receiver_id: "u-1",
  status: "pending",
  created_at: new Date().toISOString(),
};

describe("friendsStore", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    // mockReset clears queued mockResolvedValueOnce values that a previous
    // test may not have consumed (clearAllMocks does not).
    fetchMock.mockReset();
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "u-1" }, access_token: "token-abc" } },
      error: null,
    });
    vi.stubGlobal("fetch", fetchMock);
    // Reset store state between tests.
    useFriendsStore.setState({
      friends: [],
      profileFriends: [],
      incomingRequests: [],
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
    expect(state.incomingRequests).toEqual([]);
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

  it("fetchFriends keeps previous list on API failure", async () => {
    useFriendsStore.setState({ friends: [friend] });
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "boom" }));

    await useFriendsStore.getState().fetchFriends();

    expect(useFriendsStore.getState().friends).toEqual([friend]);
    expect(useFriendsStore.getState().isLoading).toBe(false);
  });

  it("fetchProfileFriends loads friends for a specific user", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [friend] }));

    await useFriendsStore.getState().fetchProfileFriends("u-2");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/friends?user_id=u-2",
      expect.anything(),
    );
    expect(useFriendsStore.getState().profileFriends).toEqual([friend]);
  });

  it("fetchRequests loads incoming requests", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [request] }));

    await useFriendsStore.getState().fetchRequests();

    expect(useFriendsStore.getState().incomingRequests).toEqual([request]);
  });

  it("sendRequest optimistically marks pending_sent and keeps it on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { status: "pending" } }));

    await useFriendsStore.getState().sendRequest("u-2");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/friends/request",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ receiver_id: "u-2" }),
      }),
    );
    expect(useFriendsStore.getState().friendStatusMap["u-2"].status).toBe("pending_sent");
  });

  it("sendRequest marks friends and refreshes when already friends", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { status: "friends" } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: [friend] }));

    await useFriendsStore.getState().sendRequest("u-2");

    // fetchFriends() is fire-and-forget inside sendRequest — wait for it.
    await vi.waitFor(() => {
      expect(useFriendsStore.getState().friends).toEqual([friend]);
    });
    expect(useFriendsStore.getState().friendStatusMap["u-2"].status).toBe("friends");
    expect(fetchMock).toHaveBeenCalledTimes(2); // POST + refresh
  });

  it("sendRequest rolls back the optimistic status on failure", async () => {
    useFriendsStore.setState({
      friendStatusMap: { "u-2": { status: "none" } },
    });
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "denied" }));

    await expect(useFriendsStore.getState().sendRequest("u-2")).rejects.toThrow("denied");

    expect(useFriendsStore.getState().friendStatusMap["u-2"].status).toBe("none");
  });

  it("sendRequest removes the status entry when there was no previous status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "denied" }));

    await expect(useFriendsStore.getState().sendRequest("u-9")).rejects.toThrow("denied");

    expect(useFriendsStore.getState().friendStatusMap["u-9"]).toBeUndefined();
  });

  it("acceptRequest removes the request and marks the user as friend", async () => {
    useFriendsStore.setState({ incomingRequests: [request] });
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { ok: true } }));

    await useFriendsStore.getState().acceptRequest("req-1", "u-2");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/friends/request/req-1/accept",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(useFriendsStore.getState().incomingRequests).toEqual([]);
    expect(useFriendsStore.getState().friendStatusMap["u-2"].status).toBe("friends");
  });

  it("acceptRequest restores the request list and re-checks status on failure", async () => {
    useFriendsStore.setState({ incomingRequests: [request] });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: false, error: "boom" }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { status: "pending_received", request_id: "req-1" } }));

    await expect(useFriendsStore.getState().acceptRequest("req-1", "u-2")).rejects.toThrow("boom");

    expect(useFriendsStore.getState().incomingRequests).toEqual([request]);
    // checkStatus() is fire-and-forget in the catch path — wait for it to
    // re-populate the map from the server.
    await vi.waitFor(() => {
      expect(useFriendsStore.getState().friendStatusMap["u-2"]).toEqual({
        status: "pending_received",
        requestId: "req-1",
      });
    });
  });

  it("rejectRequest removes the request optimistically and restores on failure", async () => {
    useFriendsStore.setState({ incomingRequests: [request] });
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));

    await useFriendsStore.getState().rejectRequest("req-1");

    expect(useFriendsStore.getState().incomingRequests).toEqual([]);

    // Failure path restores the list.
    useFriendsStore.setState({ incomingRequests: [request] });
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "nope" }));
    await expect(useFriendsStore.getState().rejectRequest("req-1")).rejects.toThrow("nope");
    expect(useFriendsStore.getState().incomingRequests).toEqual([request]);
  });

  it("cancelRequest deletes the pending request", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));

    await useFriendsStore.getState().cancelRequest("req-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/friends/request/req-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("cancelRequest throws on failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "gone" }));

    await expect(useFriendsStore.getState().cancelRequest("req-1")).rejects.toThrow("gone");
  });

  it("removeFriend removes from list optimistically and sets status none", async () => {
    useFriendsStore.setState({
      friends: [friend],
      friendStatusMap: { "u-2": { status: "friends" } },
    });
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));

    await useFriendsStore.getState().removeFriend("u-2");

    expect(useFriendsStore.getState().friends).toEqual([]);
    expect(useFriendsStore.getState().friendStatusMap["u-2"].status).toBe("none");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/friends/u-2",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("removeFriend restores previous state on failure", async () => {
    useFriendsStore.setState({
      friends: [friend],
      friendStatusMap: { "u-2": { status: "friends", requestId: "req-1" } },
    });
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "boom" }));

    await expect(useFriendsStore.getState().removeFriend("u-2")).rejects.toThrow("boom");

    expect(useFriendsStore.getState().friends).toEqual([friend]);
    expect(useFriendsStore.getState().friendStatusMap["u-2"]).toEqual({
      status: "friends",
      requestId: "req-1",
    });
  });

  it("checkStatus stores the server status and request id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { status: "pending_received", request_id: "req-1" } }),
    );

    const status = await useFriendsStore.getState().checkStatus("u-2");

    expect(status).toBe("pending_received");
    expect(useFriendsStore.getState().friendStatusMap["u-2"]).toEqual({
      status: "pending_received",
      requestId: "req-1",
    });
  });

  it("checkStatus returns none on failure", async () => {
    fetchMock.mockRejectedValue(new Error("network"));

    const status = await useFriendsStore.getState().checkStatus("u-2");

    expect(status).toBe("none");
  });

  it("setStatus writes the map directly", () => {
    useFriendsStore.getState().setStatus("u-2", "pending_sent");

    expect(useFriendsStore.getState().friendStatusMap["u-2"]).toEqual({
      status: "pending_sent",
      requestId: undefined,
    });
  });
});
