import { create } from "zustand";
import { apiClient, type Notification } from "@/integrations/api/client";
import type { WebSocketMessage } from "@/services/websocket";
import { eventManager } from "@/services/eventManager";

export interface AchievementData {
  notification_id: string;
  id: string;
  group_key: string;
  name: string;
  description: string;
  icon: string;
  rarity: string;
  level: number;
  max_level: number;
  is_first_time: boolean;
  prev_level: number;
}

type NotificationStore = {
  notifications: Notification[];
  unreadCount: number;
  hasMore: boolean;
  offset: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  initialized: boolean;
  lastUnlockedAchievement: AchievementData | null;

  init: (userId: string) => void;
  fetchInitial: (isRead?: string) => Promise<void>;
  fetchMore: () => Promise<void>;
  resetAndFetch: (isRead?: string) => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAchievement: () => void;
  cleanup: () => void;
};

const PAGE_SIZE = 20;

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  hasMore: true,
  offset: 0,
  isLoading: true,
  isLoadingMore: false,
  initialized: false,
  lastUnlockedAchievement: null,

  init: (userId: string) => {
    if (get().initialized) return;

    set({ isLoading: true, notifications: [], offset: 0, hasMore: true });

    // Ensure eventManager is initialized
    eventManager.init(userId);

    // Register WS handler for new notifications
    eventManager.on("new_notification", (message: WebSocketMessage) => {
      const notif = message.data as Notification & { achievement?: AchievementData };
      if (!notif || !notif.id) return;

      set((state) => {
        const exists = state.notifications.some((n) => n.id === notif.id);
        const notifications = exists
          ? state.notifications
          : [notif, ...state.notifications];

        const update: Partial<NotificationStore> = { notifications };

        if (!notif.is_read) {
          update.unreadCount = state.unreadCount + 1;
        }

        if (notif.type === "achievement_unlock" && notif.achievement) {
          update.lastUnlockedAchievement = {
            notification_id: notif.id,
            id: notif.achievement.id || "",
            group_key: notif.achievement.group_key || "",
            name: notif.achievement.name,
            description: notif.achievement.description || "",
            icon: notif.achievement.icon || "sparkles",
            rarity: notif.achievement.rarity || "common",
            level: notif.achievement.level || 1,
            max_level: notif.achievement.max_level || 1,
            is_first_time: notif.achievement.is_first_time || false,
            prev_level: notif.achievement.prev_level || 0,
          };
        }

        return update;
      });
    });

    // Register callback for EventManager count updates (reconnection recovery)
    eventManager.setNotificationCallbacks({
      onCountUpdate: (count: number) => {
        set({ unreadCount: count });
      },
    });

    get().fetchInitial().then(() => set({ isLoading: false, initialized: true }));
  },

  fetchInitial: async (isRead?: string) => {
    try {
      const params: { limit: number; offset: number; is_read?: string } = {
        limit: PAGE_SIZE,
        offset: 0,
      };
      if (isRead) params.is_read = isRead;

      const resp = await apiClient.getNotifications(params);
      const data = (resp.data as Notification[] | null) ?? [];

      set((state) => {
        const existingIds = new Set(state.notifications.map((n) => n.id));
        const newItems = data.filter((n) => !existingIds.has(n.id));
        const merged = [...newItems, ...state.notifications].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        return {
          notifications: merged,
          offset: data.length,
          hasMore: resp.has_more ?? data.length >= PAGE_SIZE,
        };
      });
    } catch {
      // Silent
    }
  },

  fetchMore: async () => {
    const { offset, hasMore, isLoadingMore } = get();
    if (isLoadingMore || !hasMore) return;

    set({ isLoadingMore: true });

    try {
      const resp = await apiClient.getNotifications({ limit: PAGE_SIZE, offset });
      const data = (resp.data as Notification[] | null) ?? [];

      set((state) => {
        const existingIds = new Set(state.notifications.map((n) => n.id));
        const newItems = data.filter((n) => !existingIds.has(n.id));
        return {
          notifications: [...state.notifications, ...newItems],
          offset: state.offset + data.length,
          hasMore: resp.has_more ?? data.length >= PAGE_SIZE,
          isLoadingMore: false,
        };
      });
    } catch {
      set({ isLoadingMore: false });
    }
  },

  resetAndFetch: async (isRead?: string) => {
    set({ notifications: [], offset: 0, hasMore: true });
    await get().fetchInitial(isRead);
  },

  fetchUnreadCount: async () => {
    try {
      const resp = await apiClient.getUnreadNotificationsCount();
      if (resp.data) {
        const d = resp.data as { unread_count: number };
        set({ unreadCount: d.unread_count });
      }
    } catch {
      // Silent
    }
  },

  markAsRead: (id: string) => {
    const prevNotifications = get().notifications;
    const prevCount = get().unreadCount;

    set((state) => {
      const target = state.notifications.find((n) => n.id === id && !n.is_read);
      if (!target) return {};
      return {
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, is_read: true } : n
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      };
    });

    apiClient.markNotificationAsRead(id).catch(() => {
      set({ notifications: prevNotifications, unreadCount: prevCount });
    });
  },

  markAllAsRead: () => {
    const prevNotifications = get().notifications;
    const prevCount = get().unreadCount;

    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, is_read: true })),
      unreadCount: 0,
    }));

    apiClient.markAllNotificationsAsRead().catch(() => {
      set({ notifications: prevNotifications, unreadCount: prevCount });
    });
  },

  clearAchievement: () => {
    set({ lastUnlockedAchievement: null });
  },

  cleanup: () => {
    set({
      notifications: [],
      unreadCount: 0,
      offset: 0,
      hasMore: true,
      initialized: false,
      lastUnlockedAchievement: null,
    });
  },
}));
