import { create } from "zustand";
import { apiClient, type Notification } from "@/integrations/api/client";
import type { WebSocketMessage } from "@/services/websocket";
import { eventManager } from "@/services/eventManager";

type NotificationStore = {
  notifications: Notification[];
  unreadCount: number;
  hasMore: boolean;
  offset: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  initialized: boolean;
  activeFilter: string | undefined;

  init: (userId: string) => void;
  fetchInitial: (isRead?: string) => Promise<void>;
  fetchMore: () => Promise<void>;
  resetAndFetch: (isRead?: string) => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
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
  activeFilter: undefined,

  init: (userId: string) => {
    if (get().initialized) return;

    set({ isLoading: true, notifications: [], offset: 0, hasMore: true });

    // Ensure eventManager is initialized
    eventManager.init(userId);

    // Register WS handler for new notifications
    eventManager.on("new_notification", (message: WebSocketMessage) => {
      const notif = message.data as Notification;
      if (!notif || !notif.id) return;

      set((state) => {
        // A burst group is merged server-side and re-sent with the same id,
        // updated title/count and a bumped created_at. Replace it in place and
        // move it to the top instead of adding a duplicate row.
        const existing = state.notifications.find((n) => n.id === notif.id);
        const notifications = existing
          ? [notif, ...state.notifications.filter((n) => n.id !== notif.id)]
          : [notif, ...state.notifications];

        const update: Partial<NotificationStore> = { notifications };

        if (existing) {
          if (existing.is_read && !notif.is_read) {
            update.unreadCount = state.unreadCount + 1;
          } else if (!existing.is_read && notif.is_read) {
            update.unreadCount = Math.max(0, state.unreadCount - 1);
          }
        } else if (!notif.is_read) {
          update.unreadCount = state.unreadCount + 1;
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

    // Fetch the unread badge independently of the messenger store's sync, so
    // the bell is correct even before the messenger initializes.
    get().fetchUnreadCount();

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
          activeFilter: isRead,
        };
      });
    } catch {
      // Silent
    }
  },

  fetchMore: async () => {
    const { offset, hasMore, isLoadingMore, activeFilter } = get();
    if (isLoadingMore || !hasMore) return;

    set({ isLoadingMore: true });

    try {
      const params: { limit: number; offset: number; is_read?: string } = { limit: PAGE_SIZE, offset };
      if (activeFilter) params.is_read = activeFilter;
      const resp = await apiClient.getNotifications(params);
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
    set({ notifications: [], offset: 0, hasMore: true, activeFilter: isRead });
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

  cleanup: () => {
    set({
      notifications: [],
      unreadCount: 0,
      offset: 0,
      hasMore: true,
      initialized: false,
      activeFilter: undefined,
    });
  },
}));
