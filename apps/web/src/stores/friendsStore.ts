import { create } from "zustand";
import { api } from "@/integrations/api/compat";

export type FriendStatus = "none" | "pending_sent" | "pending_received" | "friends";

export interface Friend {
  friendship_id: string;
  user_id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  is_online: boolean;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  sender_username: string;
  sender_avatar_url?: string | null;
  sender_display_name?: string | null;
  receiver_id: string;
  status: string;
  created_at: string;
}

interface FriendsStore {
  friends: Friend[];
  incomingRequests: FriendRequest[];
  friendStatusMap: Record<string, { status: FriendStatus; requestId?: string }>;
  isLoading: boolean;

  fetchFriends: () => Promise<void>;
  fetchRequests: () => Promise<void>;
  sendRequest: (userId: string) => Promise<void>;
  acceptRequest: (requestId: string) => Promise<void>;
  rejectRequest: (requestId: string) => Promise<void>;
  cancelRequest: (requestId: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
  checkStatus: (userId: string) => Promise<FriendStatus>;
  setStatus: (userId: string, status: FriendStatus, requestId?: string) => void;
}

async function apiRequest(url: string, options?: RequestInit) {
  const { data: { session } } = await api.auth.getSession();
  const token = session?.access_token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options?.headers as Record<string, string> || {}),
  };
  const res = await fetch(url, { ...options, headers });
  return res.json();
}

export const useFriendsStore = create<FriendsStore>((set, get) => ({
  friends: [],
  incomingRequests: [],
  friendStatusMap: {},
  isLoading: false,

  fetchFriends: async () => {
    set({ isLoading: true });
    try {
      const resp = await apiRequest("/api/v1/friends");
      if (resp.success) {
        set({ friends: resp.data || [] });
      }
    } catch {
      // Silent
    } finally {
      set({ isLoading: false });
    }
  },

  fetchRequests: async () => {
    try {
      const resp = await apiRequest("/api/v1/friends/requests");
      if (resp.success) {
        set({ incomingRequests: resp.data || [] });
      }
    } catch {
      // Silent
    }
  },

  sendRequest: async (userId: string) => {
    const prev = get().friendStatusMap[userId];

    set((state) => ({
      friendStatusMap: {
        ...state.friendStatusMap,
        [userId]: { status: "pending_sent" },
      },
    }));

    try {
      const resp = await apiRequest("/api/v1/friends/request", {
        method: "POST",
        body: JSON.stringify({ receiver_id: userId }),
      });

      if (!resp.success) {
        if (prev) {
          set((state) => ({
            friendStatusMap: { ...state.friendStatusMap, [userId]: prev },
          }));
        } else {
          set((state) => {
            const { [userId]: _, ...rest } = state.friendStatusMap;
            return { friendStatusMap: rest };
          });
        }
        throw new Error(resp.error || "Failed");
      }

      if (resp.data?.status === "friends") {
        set((state) => ({
          friendStatusMap: {
            ...state.friendStatusMap,
            [userId]: { status: "friends" },
          },
        }));
        get().fetchFriends();
      }
    } catch (e) {
      if (prev) {
        set((state) => ({
          friendStatusMap: { ...state.friendStatusMap, [userId]: prev },
        }));
      } else {
        set((state) => {
          const { [userId]: _, ...rest } = state.friendStatusMap;
          return { friendStatusMap: rest };
        });
      }
      throw e;
    }
  },

  acceptRequest: async (requestId: string) => {
    const prevRequests = get().incomingRequests;
    const request = prevRequests.find((r) => r.id === requestId);
    const senderId = request?.sender_id;

    set((state) => ({
      incomingRequests: state.incomingRequests.filter((r) => r.id !== requestId),
      ...(senderId ? {
        friendStatusMap: {
          ...state.friendStatusMap,
          [senderId]: { status: "friends" as FriendStatus },
        },
      } : {}),
    }));

    try {
      const resp = await apiRequest(`/api/v1/friends/request/${requestId}/accept`, {
        method: "PUT",
      });

      if (!resp.success) {
        set({ incomingRequests: prevRequests });
        if (senderId) {
          get().checkStatus(senderId);
        }
        throw new Error(resp.error || "Failed");
      }

      await get().fetchFriends();
      if (senderId) {
        get().checkStatus(senderId);
      }
    } catch (e) {
      set({ incomingRequests: prevRequests });
      if (senderId) {
        get().checkStatus(senderId);
      }
      throw e;
    }
  },

  rejectRequest: async (requestId: string) => {
    const prevRequests = get().incomingRequests;

    set((state) => ({
      incomingRequests: state.incomingRequests.filter((r) => r.id !== requestId),
    }));

    try {
      const resp = await apiRequest(`/api/v1/friends/request/${requestId}/reject`, {
        method: "PUT",
      });

      if (!resp.success) {
        set({ incomingRequests: prevRequests });
        throw new Error(resp.error || "Failed");
      }
    } catch (e) {
      set({ incomingRequests: prevRequests });
      throw e;
    }
  },

  cancelRequest: async (requestId: string) => {
    const resp = await apiRequest(`/api/v1/friends/request/${requestId}`, {
      method: "DELETE",
    });

    if (!resp.success) {
      throw new Error(resp.error || "Failed");
    }
  },

  removeFriend: async (userId: string) => {
    const prevFriends = get().friends;
    const prevStatus = get().friendStatusMap[userId];

    set((state) => ({
      friends: state.friends.filter((f) => f.user_id !== userId),
      friendStatusMap: {
        ...state.friendStatusMap,
        [userId]: { status: "none" },
      },
    }));

    try {
      const resp = await apiRequest(`/api/v1/friends/${userId}`, {
        method: "DELETE",
      });

      if (!resp.success) {
        set({ friends: prevFriends });
        if (prevStatus) {
          set((state) => ({
            friendStatusMap: { ...state.friendStatusMap, [userId]: prevStatus },
          }));
        }
        throw new Error(resp.error || "Failed");
      }
    } catch (e) {
      set({ friends: prevFriends });
      if (prevStatus) {
        set((state) => ({
          friendStatusMap: { ...state.friendStatusMap, [userId]: prevStatus },
        }));
      }
      throw e;
    }
  },

  checkStatus: async (userId: string): Promise<FriendStatus> => {
    try {
      const resp = await apiRequest(`/api/v1/friends/status/${userId}`);
      if (resp.success) {
        const status = resp.data.status as FriendStatus;
        const requestId = resp.data.request_id;
        set((state) => ({
          friendStatusMap: {
            ...state.friendStatusMap,
            [userId]: { status, requestId },
          },
        }));
        return status;
      }
    } catch {
      // Silent
    }
    return "none";
  },

  setStatus: (userId: string, status: FriendStatus, requestId?: string) => {
    set((state) => ({
      friendStatusMap: {
        ...state.friendStatusMap,
        [userId]: { status, requestId },
      },
    }));
  },
}));
