import { useEffect, useState } from "react";
import { wsService } from "@/services/websocket";
import {
  AchievementUnlockToast,
  queueAchievementUnlock,
  advanceToastQueue,
  clearToastQueue,
  type UnlockData,
} from "@/components/AchievementUnlockToast";

/**
 * Global listener for achievement unlock notifications.
 * Listens on WebSocket for `new_notification` events of type `achievement_unlock`,
 * and falls back to polling the notifications API every 30s when WebSocket is disconnected.
 *
 * Renders a beautiful AchievementUnlockToast with rarity theming, level dots,
 * and smooth enter/exit animations.
 *
 * Mount once in AppLayout.
 */
export function AchievementToastListener() {
  const [toast, setToast] = useState<UnlockData | null>(null);

  useEffect(() => {
    let pollTimer: NodeJS.Timeout | null = null;
    let lastPollId = "";

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
      };

      queueAchievementUnlock(data, (d) => setToast(d));
    });

    // ── Polling fallback (only when WebSocket is disconnected) ──
    const pollNotifications = async () => {
      // Skip polling if WebSocket is already connected to avoid duplicate toasts
      if (wsService.connected) return;
      try {
        const token = localStorage.getItem("auth_token");
        if (!token) return;

        const res = await fetch("/api/v1/notifications?order=created_at.desc&limit=5", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;

        const json = await res.json();
        const items: any[] = json.data || [];

        for (const item of items) {
          if (item.type !== "achievement_unlock") continue;
          if (item.id === lastPollId) break; // already processed

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
          };

          queueAchievementUnlock(data, (d) => setToast(d));
          lastPollId = item.id;
          break; // only show the most recent unprocessed one
        }
      } catch {
        // Silently fail — polling is just a fallback
      }
    };

    // Start polling
    pollTimer = setInterval(pollNotifications, 30_000);
    // Initial poll after a short delay to let WebSocket connect first
    const initialTimer = setTimeout(pollNotifications, 5_000);

    return () => {
      wsUnsub();
      if (pollTimer) clearInterval(pollTimer);
      clearTimeout(initialTimer);
      clearToastQueue();
    };
  }, []);

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
