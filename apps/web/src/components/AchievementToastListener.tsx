import { useEffect, useState } from "react";
import { wsService } from "@/services/websocket";
import { AchievementUnlockToast, queueAchievementUnlock, getOnDismissCallback } from "@/components/AchievementUnlockToast";

interface UnlockData {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
}

/**
 * Global listener for achievement unlock notifications via WebSocket.
 * Renders AchievementUnlockToast when a new achievement is unlocked.
 * Mount once in AppLayout or App.
 */
export function AchievementToastListener() {
  const [toast, setToast] = useState<UnlockData | null>(null);

  useEffect(() => {
    const unsubscribe = wsService.on("new_notification", (msg) => {
      const notif = msg?.data;
      if (!notif || notif.type !== "achievement_unlock") return;

      const ach = notif.achievement;
      if (!ach?.name) return;

      const data: UnlockData = {
        id: ach.id || "",
        name: ach.name,
        description: ach.description || "",
        icon: ach.icon || "sparkles",
        rarity: ach.rarity || "common",
      };

      queueAchievementUnlock(data, (d) => setToast(d));
    });

    return unsubscribe;
  }, []);

  if (!toast) return null;

  const handleDismiss = () => {
    setToast(null);
    // Advance the toast queue after dismiss animation
    const cb = getOnDismissCallback();
    if (cb) setTimeout(cb, 400);
  };

  return (
    <AchievementUnlockToast
      achievement={toast}
      onDismiss={handleDismiss}
      autoDismissMs={6000}
    />
  );
}
