import { useEffect, useState, useCallback } from "react";
import { wsService } from "@/services/websocket";
import {
  AchievementUnlockToast,
  queueAchievementUnlock,
  advanceToastQueue,
  clearToastQueue,
  type UnlockData,
} from "@/components/AchievementUnlockToast";

/**
 * Помечает нотификацию как прочитанную на бэке (fire-and-forget).
 * После этого она не будет снова показана при перезагрузке страницы.
 */
async function markNotificationRead(notificationId: string): Promise<void> {
  if (!notificationId) return;
  try {
    const token = localStorage.getItem("auth_token");
    if (!token) return;
    await fetch(`/api/v1/notifications/${notificationId}/read`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Silently fail
  }
}

/**
 * Global listener for achievement unlock notifications.
 * Listens on WebSocket for `new_notification` events of type `achievement_unlock`,
 * and falls back to polling the notifications API every 30s when WebSocket is disconnected.
 *
 * Polling fetches only unread notifications (`is_read=eq.false`) and marks them
 * as read after display, so they never repeat across page reloads.
 *
 * Renders a beautiful AchievementUnlockToast with rarity theming, level dots,
 * and smooth enter/exit animations.
 *
 * Mount once in AppLayout.
 */
export function AchievementToastListener() {
  const [toast, setToast] = useState<UnlockData | null>(null);

  // Wrap setToast to also mark the notification as read on the backend
  const handleRender = useCallback((data: UnlockData) => {
    setToast(data);
    // Mark as read immediately when shown — prevents re-show on page reload
    if (data.notification_id) {
      markNotificationRead(data.notification_id);
    }
  }, []);

  useEffect(() => {
    let pollTimer: NodeJS.Timeout | null = null;

    // ── WebSocket listener ──────────────────────────────
    const wsUnsub = wsService.on("new_notification", (msg) => {
      const notif = msg?.data;
      if (!notif || notif.type !== "achievement_unlock") return;

      const ach = notif.achievement;
      if (!ach?.name) return;

      const data: UnlockData = {
        id: ach.id || "",
        group_key: ach.group_key || "",
        name: ach.name,
        description: ach.description || "",
        icon: ach.icon || "sparkles",
        rarity: ach.rarity || "common",
        level: ach.level || 1,
        max_level: ach.max_level || 1,
        is_first_time: ach.is_first_time || false,
        prev_level: ach.prev_level || 0,
        notification_id: notif.notification_id || "",
      };

      queueAchievementUnlock(data, handleRender);
    });

    // ── Polling fallback (only when WebSocket is disconnected) ──
    const pollNotifications = async () => {
      // Skip polling if WebSocket is already connected to avoid duplicate toasts
      if (wsService.connected) return;
      try {
        const token = localStorage.getItem("auth_token");
        if (!token) return;

        // Only fetch UNREAD notifications — once marked read they won't return
        const res = await fetch(
          "/api/v1/notifications?is_read=eq.false&order=created_at.desc&limit=5",
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return;

        const json = await res.json();
        const items: any[] = json.data || [];

        for (const item of items) {
          if (item.type !== "achievement_unlock") continue;

          // Parse achievement data from the notification title/message
          // The backend stores it as: title="🏆 Achievement Name", message="Description"
          const name = (item.title || "").replace(/^🏆\s*/, "");
          if (!name) continue;

          const data: UnlockData = {
            id: item.id,
            name,
            description: item.message || "",
            icon: "sparkles",
            rarity: "common",
            level: 1,
            max_level: 1,
            notification_id: item.id, // notification row ID — will be marked read
          };

          queueAchievementUnlock(data, handleRender);
          break; // only show the most recent unread one
        }
      } catch {
        // Silently fail — polling is just a fallback
      }
    };

    // Start polling (every 30s while disconnected)
    pollTimer = setInterval(pollNotifications, 30_000);
    // Initial poll after a short delay to let WebSocket connect first
    const initialTimer = setTimeout(pollNotifications, 5_000);

    return () => {
      wsUnsub();
      if (pollTimer) clearInterval(pollTimer);
      clearTimeout(initialTimer);
      clearToastQueue();
    };
  }, [handleRender]);

  const handleDismiss = () => {
    setToast(null);
    advanceToastQueue();
  };

  if (!toast) return null;

  return (
    <AchievementUnlockToast
      achievement={toast}
      onDismiss={handleDismiss}
      autoDismissMs={7000}
    />
  );
}
