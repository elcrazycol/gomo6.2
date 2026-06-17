import { useEffect, useState } from "react";
import { useNotificationStore } from "@/stores/notificationStore";
import {
  AchievementUnlockToast,
  queueAchievementUnlock,
  advanceToastQueue,
  type UnlockData,
} from "@/components/AchievementUnlockToast";

const shownNotificationIds = new Set<string>();

export function AchievementToastListener() {
  const [toast, setToast] = useState<UnlockData | null>(null);

  const lastAchievement = useNotificationStore((s) => s.lastUnlockedAchievement);
  const clearAchievement = useNotificationStore((s) => s.clearAchievement);
  const markAsRead = useNotificationStore((s) => s.markAsRead);

  useEffect(() => {
    if (!lastAchievement) return;

    if (shownNotificationIds.has(lastAchievement.notification_id)) {
      clearAchievement();
      return;
    }

    const data: UnlockData = {
      id: lastAchievement.id,
      group_key: lastAchievement.group_key,
      name: lastAchievement.name,
      description: lastAchievement.description,
      icon: lastAchievement.icon,
      rarity: lastAchievement.rarity as UnlockData['rarity'],
      level: lastAchievement.level,
      max_level: lastAchievement.max_level,
      is_first_time: lastAchievement.is_first_time,
      prev_level: lastAchievement.prev_level,
      notification_id: lastAchievement.notification_id,
    };

    shownNotificationIds.add(lastAchievement.notification_id);
    markAsRead(lastAchievement.notification_id);
    clearAchievement();

    queueAchievementUnlock(data, (d) => {
      setToast(d);
    });
  }, [lastAchievement, clearAchievement, markAsRead]);

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
