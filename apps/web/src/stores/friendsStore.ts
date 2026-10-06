import { create } from "zustand";
import { api } from "@/integrations/api/compat";
import { useLoadingBarStore } from "@/stores/loadingBarStore";

/**
 * Relationship with another user from the viewer's perspective.
 * - `none` — not following, not followed by, not friends
 * - `subscribed` — the viewer follows them (they may or may not follow back)
 * - `friends` — mutual follow (friendship)
 */
export type FriendStatus = "none" | "subscribed" | "friends";

export interface Friend {
  friendship_id: string;
  user_id: string;
  /** Public number of the friend, for /profile/<n> links. */
  public_id?: number | null;
  username: string;
  display_name?: string | null;
  nickname_emoji_id?: string | null;
  avatar_url?: string | null;
  is_online: boolean;
}

/** A user in a subscriber/subscription list. `is_friend` marks a mutual pair. */
export interface SubscriptionUser {
  user_id: string;
  /** Public number of the user, for /profile/<n> links. */
  public_id?: number | null;
  username: string;
  display_name?: string | null;
  nickname_emoji_id?: string | null;
  avatar_url?: string | null;
  is_online: boolean;
  is_friend: boolean;
  subscribed_at: string;
}

interface FriendsStore {
  friends: Friend[];
  profileFriends: Friend[];
  profileSubscribers: SubscriptionUser[];
  profileSubscriptions: SubscriptionUser[];
  /** Which profile the cached subscriber/subscription lists belong to (guards
   *  against showing a previous profile's list while the next one loads). */
  profileSubscribersFor: string | null;
  profileSubscriptionsFor: string | null;
  friendStatusMap: Record<string, { status: FriendStatus; followsYou?: boolean }>;
  isLoading: boolean;

  fetchFriends: () => Promise<void>;
  fetchProfileFriends: (userId: string) => Promise<void>;
  fetchProfileSubscribers: (userId: string) => Promise<void>;
  fetchProfileSubscriptions: (userId: string) => Promise<void>;
  subscribe: (userId: string) => Promise<void>;
  unsubscribe: (userId: string) => Promise<void>;
  checkStatus: (userId: string) => Promise<FriendStatus>;
  setStatus: (userId: string, status: FriendStatus, followsYou?: boolean) => void;
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

/** Restore a status entry to its previous value (or drop it if there was none). */
function restoreStatus(
  set: (fn: (state: FriendsStore) => Partial<FriendsStore>) => void,
  userId: string,
  prev?: { status: FriendStatus; followsYou?: boolean },
) {
  if (prev) {
    set((state) => ({
      friendStatusMap: { ...state.friendStatusMap, [userId]: prev },
    }));
  } else {
    set((state) => {
      const { [userId]: _removed, ...rest } = state.friendStatusMap;
      return { friendStatusMap: rest };
    });
  }
}

export const useFriendsStore = create<FriendsStore>((set, get) => ({
  friends: [],
  profileFriends: [],
  profileSubscribers: [],
  profileSubscriptions: [],
  profileSubscribersFor: null,
  profileSubscriptionsFor: null,
  friendStatusMap: {},
  isLoading: false,

  fetchFriends: async () => {
    set({ isLoading: true });
    const { begin, end } = useLoadingBarStore.getState();
    begin();
    try {
      const resp = await apiRequest("/api/v1/friends");
      if (resp.success) {
        set({ friends: resp.data || [] });
      }
    } catch {
      // Silent
    } finally {
      end();
      set({ isLoading: false });
    }
  },

  fetchProfileFriends: async (userId: string) => {
    // Guests cannot read other users' friends (protected endpoint) — skip the
    // doomed 401 instead of firing it on every profile page load.
    const { data: { session } } = await api.auth.getSession();
    if (!session?.user) {
      set({ profileFriends: [], isLoading: false });
      return;
    }
    set({ isLoading: true });
    const { begin, end } = useLoadingBarStore.getState();
    begin();
    try {
      const resp = await apiRequest(`/api/v1/friends?user_id=${userId}`);
      if (resp.success) {
        set({ profileFriends: resp.data || [] });
      }
    } catch {
      // Silent
    } finally {
      end();
      set({ isLoading: false });
    }
  },

  fetchProfileSubscribers: async (userId: string) => {
    const { data: { session } } = await api.auth.getSession();
    if (!session?.user) {
      set({ profileSubscribers: [], profileSubscribersFor: userId, isLoading: false });
      return;
    }
    set({ isLoading: true });
    const { begin, end } = useLoadingBarStore.getState();
    begin();
    try {
      const resp = await apiRequest(`/api/v1/friends/subscribers?user_id=${userId}`);
      if (resp.success) {
        set({ profileSubscribers: resp.data || [] });
      }
    } catch {
      // Silent
    } finally {
      end();
      set({ isLoading: false, profileSubscribersFor: userId });
    }
  },

  fetchProfileSubscriptions: async (userId: string) => {
    const { data: { session } } = await api.auth.getSession();
    if (!session?.user) {
      set({ profileSubscriptions: [], profileSubscriptionsFor: userId, isLoading: false });
      return;
    }
    set({ isLoading: true });
    const { begin, end } = useLoadingBarStore.getState();
    begin();
    try {
      const resp = await apiRequest(`/api/v1/friends/subscriptions?user_id=${userId}`);
      if (resp.success) {
        set({ profileSubscriptions: resp.data || [] });
      }
    } catch {
      // Silent
    } finally {
      end();
      set({ isLoading: false, profileSubscriptionsFor: userId });
    }
  },

  subscribe: async (userId: string) => {
    const prev = get().friendStatusMap[userId];

    set((state) => ({
      friendStatusMap: {
        ...state.friendStatusMap,
        [userId]: { status: "subscribed", followsYou: prev?.followsYou },
      },
    }));

    try {
      const resp = await apiRequest("/api/v1/friends/subscribe", {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
      });

      if (!resp.success) {
        restoreStatus(set, userId, prev);
        throw new Error(resp.error || "Failed");
      }

      const status: FriendStatus = resp.data?.status === "friends" ? "friends" : "subscribed";
      set((state) => ({
        friendStatusMap: {
          ...state.friendStatusMap,
          [userId]: { status, followsYou: status === "friends" ? true : prev?.followsYou },
        },
      }));
      if (status === "friends") {
        get().fetchFriends();
      }
    } catch (e) {
      restoreStatus(set, userId, prev);
      throw e;
    }
  },

  unsubscribe: async (userId: string) => {
    const prev = get().friendStatusMap[userId];
    const prevFriends = get().friends;

    set((state) => ({
      friends: state.friends.filter((f) => f.user_id !== userId),
      friendStatusMap: {
        ...state.friendStatusMap,
        [userId]: { status: "none", followsYou: prev?.followsYou },
      },
    }));

    try {
      const resp = await apiRequest(`/api/v1/friends/subscribe/${userId}`, {
        method: "DELETE",
      });

      if (!resp.success) {
        set({ friends: prevFriends });
        restoreStatus(set, userId, prev);
        throw new Error(resp.error || "Failed");
      }
    } catch (e) {
      set({ friends: prevFriends });
      restoreStatus(set, userId, prev);
      throw e;
    }
  },

  checkStatus: async (userId: string): Promise<FriendStatus> => {
    try {
      const resp = await apiRequest(`/api/v1/friends/status/${userId}`);
      if (resp.success) {
        const status = resp.data.status as FriendStatus;
        const followsYou = Boolean(resp.data.follows_you);
        set((state) => ({
          friendStatusMap: {
            ...state.friendStatusMap,
            [userId]: { status, followsYou },
          },
        }));
        return status;
      }
    } catch {
      // Silent
    }
    return "none";
  },

  setStatus: (userId: string, status: FriendStatus, followsYou?: boolean) => {
    set((state) => ({
      friendStatusMap: {
        ...state.friendStatusMap,
        [userId]: { status, followsYou },
      },
    }));
  },
}));
