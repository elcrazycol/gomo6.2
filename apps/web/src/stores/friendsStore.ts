import { create } from "zustand";

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
  outgoingRequests: FriendRequest[];
  friendStatusMap: Record<string, { status: FriendStatus; requestId?: string }>;
  isLoading: boolean;

  fetchFriends: () => Promise<void>;
  fetchRequests: () => Promise<void>;
  sendRequest: (userId: string) => Promise<void>;
  acceptRequest: (requestId: string) => Promise<void>;
  rejectRequest: (requestId: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
  checkStatus: (userId: string) => Promise<FriendStatus>;
  setStatus: (userId: string, status: FriendStatus, requestId?: string) => void;
}

async function apiRequest(url: string, options?: RequestInit) {
  const token = localStorage.getItem("access_token");
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
  outgoingRequests: [],
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

    // Optimistic update
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
        // Revert on error
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
        return;
      }

      // Update status based on response
      if (resp.data?.status === "friends") {
        set((state) => ({
          friendStatusMap: {
            ...state.friendStatusMap,
            [userId]: { status: "friends" },
          },
        }));
        get().fetchFriends();
      }
    } catch {
      // Revert on error
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
    }
  },

  acceptRequest: async (requestId: string) => {
    const prev = get().incomingRequests;
    const request = prev.find((r) => r.id === requestId);
    if (!request) return;

    // Optimistic update
    set((state) => ({
      incomingRequests: state.incomingRequests.filter((r) => r.id !== requestId),
      friendStatusMap: {
        ...state.friendStatusMap,
        [request.sender_id]: { status: "friends" },
      },
    }));

    try {
      const resp = await apiRequest(`/api/v1/friends/request/${requestId}/accept`, {
        method: "PUT",
      });

      if (!resp.success) {
        set({ incomingRequests: prev });
        return;
      }

      get().fetchFriends();
    } catch {
      set({ incomingRequests: prev });
    }
  },

  rejectRequest: async (requestId: string) => {
    const prev = get().incomingRequests;

    // Optimistic update
    set((state) => ({
      incomingRequests: state.incomingRequests.filter((r) => r.id !== requestId),
    }));

    try {
      const resp = await apiRequest(`/api/v1/friends/request/${requestId}/reject`, {
        method: "PUT",
      });

      if (!resp.success) {
        set({ incomingRequests: prev });
      }
    } catch {
      set({ incomingRequests: prev });
    }
  },

  removeFriend: async (userId: string) => {
    const prevFriends = get().friends;
    const prevStatus = get().friendStatusMap[userId];

    // Optimistic update
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
      }
    } catch {
      set({ friends: prevFriends });
      if (prevStatus) {
        set((state) => ({
          friendStatusMap: { ...state.friendStatusMap, [userId]: prevStatus },
        }));
      }
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
