import type { AchievementData } from "@/components/AchievementCard";
import type { UserAchievementRaw } from "./types";

/** Map a raw user_achievements row to the AchievementData the UI renders. */
export function mapUserAchievementRaw(ua: UserAchievementRaw): AchievementData {
  const a = ua.achievements ?? ({} as NonNullable<UserAchievementRaw["achievements"]>);
  const currentLevel = ua.current_level ?? ua.level ?? 0;
  const levels = a.levels || [];
  const levelDef = currentLevel > 0 && levels.length >= currentLevel ? levels[currentLevel - 1] : null;

  return {
    id: a.id || "",
    group_key: a.group_key,
    title: a.title,
    name: levelDef?.name || a.name || "—",
    description: levelDef?.description || a.description || "",
    icon: a.icon || "sparkles",
    category: a.category || "",
    rarity: levelDef?.rarity || a.rarity || "common",
    level: currentLevel,
    current_level: currentLevel,
    maxLevel: levels.length || 1,
    max_level: levels.length || 1,
    is_pinned: ua.is_pinned || false,
    pinned_order: ua.pinned_order || null,
    unlocked_at: ua.unlocked_at,
    progress_current: ua.progress_current || 0,
    achievement_type: a.achievement_type || "one_time",
    reward_type: levelDef?.reward_type || a.reward_type || undefined,
    reward_value: levelDef?.reward_value || a.reward_value || undefined,
    hidden: a.hidden || false,
    locked: currentLevel === 0,
    levels: levels,
  } as AchievementData;
}