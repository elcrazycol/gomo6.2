import { create } from "zustand";
import { apiClient, type Notification } from "@/integrations/api/client";
import { wsService } from "@/services/websocket";
import type { WebSocketMessage } from "@/services/websocket";

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
let pollingInterval: ReturnType<typeof setInterval> | null = null;
let wsUnsub: (() => void) | null = null;
let wsConnectedUnsub: (() => void) | null = null;
let initializedUserId: string | null = null;

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
    if (initializedUserId === userId && get().initialized) return;
    initializedUserId = userId;

    set({ isLoading: true, notifications: [], offset: 0, hasMore: true });

    const handleWsNotification = (message: WebSocketMessage) => {
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
    };

    wsService.subscribeToNotifications(userId);
    wsUnsub = wsService.on("new_notification", handleWsNotification);

    wsConnectedUnsub = wsService.on("connected", () => {
      wsService.subscribeToNotifications(userId);
      get().fetchUnreadCount();
    });

    pollingInterval = setInterval(() => {
      if (!wsService.connected) {
        get().fetchUnreadCount();
        get().fetchInitial();
      }
    }, 15000);

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

      set({
        notifications: data,
        offset: data.length,
        hasMore: resp.has_more ?? data.length >= PAGE_SIZE,
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

    apiClient.markNotificationAsRead(id).catch(() => {});
  },

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, is_read: true })),
      unreadCount: 0,
    }));

    apiClient.markAllNotificationsAsRead().catch(() => {});
  },

  clearAchievement: () => {
    set({ lastUnlockedAchievement: null });
  },

  cleanup: () => {
    if (wsUnsub) { wsUnsub(); wsUnsub = null; }
    if (wsConnectedUnsub) { wsConnectedUnsub(); wsConnectedUnsub = null; }
    if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
    initializedUserId = null;
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
