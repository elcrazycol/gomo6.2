import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Pin, PinOff, Sparkles, Lock, Trophy } from "lucide-react";
import { getAchievementIcon } from "@/components/AchievementIcons";
import { getIntlLanguage } from "@/i18n/dateLocale";

export interface AchievementLevel {
  level: number;
  threshold: number;
  /** i18n key for the level name (new catalog). */
  name_key?: string;
  /** i18n key for the level description (new catalog). */
  description_key?: string;
  /** Legacy plain-text name (old catalog rows / tests). */
  name?: string;
  /** Legacy plain-text description. */
  description?: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  reward_type?: string;
  reward_value?: string;
}

export interface AchievementData {
  id: string;
  group_key?: string;
  /** i18n key for the group title (new catalog). */
  title?: string;
  /** Legacy plain-text name / fallback. */
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity?: "common" | "uncommon" | "rare" | "epic" | "legendary";
  level?: number;
  maxLevel?: number;
  max_level?: number;
  current_level?: number;
  is_pinned?: boolean;
  pinned_order?: number;
  unlocked_at?: string;
  hidden?: boolean;
  locked?: boolean;
  progress_current?: number;
  progress_target?: number;
  achievement_type?: string;
  reward_type?: string;
  reward_value?: string;
  levels?: AchievementLevel[];
}

interface AchievementCardProps {
  achievement: AchievementData;
  onTogglePin?: (achievementId: string) => void;
  isEditing?: boolean;
  compact?: boolean;
}

// Rarity is a small colored dot + label; the rest of the card stays flat and
// neutral to match the rest of the site.
const RARITY_DOT: Record<string, string> = {
  legendary: "bg-amber-500",
  epic: "bg-purple-500",
  rare: "bg-blue-500",
  uncommon: "bg-emerald-500",
  common: "bg-muted-foreground/50",
};

const RARITY_TEXT: Record<string, string> = {
  legendary: "text-amber-600 dark:text-amber-400",
  epic: "text-purple-600 dark:text-purple-400",
  rare: "text-blue-600 dark:text-blue-400",
  uncommon: "text-emerald-600 dark:text-emerald-400",
  common: "text-muted-foreground",
};

/**
 * Get the current level definition for an achievement, or null if not unlocked.
 */
function getCurrentLevelDef(achievement: AchievementData): AchievementLevel | null {
  const levels = achievement.levels;
  const currentLevel = achievement.level ?? achievement.current_level ?? 0;
  if (!levels || levels.length === 0 || currentLevel === 0) return null;
  const idx = currentLevel - 1;
  if (idx < 0 || idx >= levels.length) return null;
  return levels[idx];
}

/**
 * Get the rarity for the current display state.
 * For unlocked multi-level: use the rarity from the current level.
 * For unlocked one-time: use achievement.rarity.
 * Fallback: common.
 */
function getDisplayRarity(achievement: AchievementData): string {
  if (achievement.locked) return "common";
  const levelDef = getCurrentLevelDef(achievement);
  if (levelDef?.rarity) return levelDef.rarity;
  return achievement.rarity || "common";
}

export function AchievementCard({
  achievement,
  onTogglePin,
  isEditing,
  compact,
}: AchievementCardProps) {
  const { t } = useTranslation();
  const [isRevealing, setIsRevealing] = useState(false);

  const isLocked = achievement.locked === true;
  const isHidden = achievement.hidden === true && isLocked;
  const rarity = getDisplayRarity(achievement);
  const IconComponent = getAchievementIcon(achievement.icon);

  // Localize a level name/description: the new catalog stores i18n keys
  // (name_key/description_key), legacy rows carry plain text.
  const levelName = (lvl?: AchievementLevel) => {
    if (!lvl) return "";
    return lvl.name_key ? t(lvl.name_key) : (lvl.name || "");
  };
  const levelDesc = (lvl?: AchievementLevel) => {
    if (!lvl) return "";
    return lvl.description_key ? t(lvl.description_key) : (lvl.description || "");
  };
  const groupTitle = achievement.title ? t(achievement.title) : achievement.name;

  // Compute levels info
  const levels = achievement.levels || [];
  const maxLevel = achievement.maxLevel ?? achievement.max_level ?? levels.length;
  const currentLevel = achievement.level ?? achievement.current_level ?? 0;

  // Next level threshold for progress bar
  const nextLevelIdx = isLocked ? 0 : currentLevel;
  const nextThreshold = levels.length > nextLevelIdx ? levels[nextLevelIdx].threshold : 0;
  const progressCurrent = achievement.progress_current ?? 0;
  const progressPercent = nextThreshold > 0
    ? Math.min(100, (progressCurrent / nextThreshold) * 100)
    : 0;

  const showProgress = nextThreshold > 0 && (isLocked || currentLevel < maxLevel);

  // Secret achievement: user must click to reveal
  if (isHidden && !isRevealing) {
    return (
      <button
        type="button"
        onClick={() => setIsRevealing(true)}
        className={cn(
          "w-full text-left p-4 bg-muted/40 border border-dashed border-border rounded-lg",
          "hover:bg-muted/60 transition-colors cursor-pointer select-none",
          "flex items-center justify-center gap-2 min-h-[72px]",
          compact && "min-h-[56px] p-3"
        )}
      >
        <Sparkles className="w-4 h-4 text-muted-foreground/60" />
        <span className="text-sm text-muted-foreground">
          {t("achievements.secretAchievement")}
        </span>
      </button>
    );
  }

  // Unlocked: the current level. Locked: the first (reachable) level.
  const levelDef = isLocked
    ? levels.length > 0 ? levels[0] : undefined
    : getCurrentLevelDef(achievement);
  const displayName = levelName(levelDef) || groupTitle;
  const displayDesc = levelDesc(levelDef) || achievement.description;

  return (
    <div
      className={cn(
        "p-4 bg-card border border-border rounded-lg",
        "transition-colors",
        isLocked && "opacity-60",
        compact && "p-3"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={cn(
            "flex-shrink-0 w-10 h-10 rounded-md bg-muted flex items-center justify-center text-muted-foreground",
            compact && "w-8 h-8"
          )}
        >
          <IconComponent size={compact ? 18 : 20} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={cn("font-medium text-sm text-foreground truncate", compact && "text-xs")}>
              {displayName}
            </p>
            {/* Rarity dot + label */}
            <span className={cn("inline-flex items-center gap-1 text-[11px]", RARITY_TEXT[rarity])}>
              <span className={cn("w-1.5 h-1.5 rounded-full", RARITY_DOT[rarity])} />
              {t(`achievements.rarity.${rarity}`)}
            </span>
            {maxLevel > 1 && (
              <span className="text-[11px] text-muted-foreground/70">
                {currentLevel}/{maxLevel}
              </span>
            )}
          </div>
          <p className={cn("text-xs text-muted-foreground mt-0.5", compact && "text-[11px]")}>
            {displayDesc}
          </p>

          {/* Progress to next level */}
          {showProgress && (
            <div className="mt-2">
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1 text-right">
                {progressCurrent} / {nextThreshold}
              </p>
            </div>
          )}

          {/* Unlock date */}
          {achievement.unlocked_at && !compact && (
            <p className="text-[11px] text-muted-foreground/50 mt-1.5">
              {t("achievements.unlockedAt")}: {new Date(achievement.unlocked_at).toLocaleDateString(getIntlLanguage(), {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          )}
        </div>

        {/* Pin button / pinned badge */}
        {isEditing && onTogglePin ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(achievement.id);
            }}
            className={cn(
              "flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md",
              "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
              achievement.is_pinned && "text-primary hover:text-primary"
            )}
            title={achievement.is_pinned ? t("achievements.unpin") : t("achievements.pin")}
          >
            {achievement.is_pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
        ) : achievement.is_pinned ? (
          <Trophy className="flex-shrink-0 w-4 h-4 text-amber-500/70 mt-0.5" />
        ) : null}
      </div>

      {/* Reward indicator */}
      {!isLocked && (levelDef?.reward_type === "garma" || achievement.reward_type === "garma") && !compact && (
        <div className="mt-2.5 pt-2.5 border-t border-border/60">
          <span className="text-[11px] text-muted-foreground/70">
            {t("achievements.reward", {
              value: levelDef?.reward_type === "garma" ? levelDef.reward_value : achievement.reward_value,
            })}
          </span>
        </div>
      )}

    </div>
  );
}
