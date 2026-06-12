import { useState } from "react";
import { cn } from "@/lib/utils";
import { Pin, PinOff, Sparkles, Trophy } from "lucide-react";
import { getAchievementIcon } from "@/components/AchievementIcons";

export interface AchievementLevel {
  level: number;
  threshold: number;
  name: string;
  description: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  reward_type?: string;
  reward_value?: string;
}

export interface AchievementData {
  id: string;
  group_key?: string;
  title?: string;
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

const RARITY_CONFIG: Record<string, {
  gradient: string;
  border: string;
  shadow: string;
  glow: string;
  bg: string;
  text: string;
  label: string;
  badge: string;
  ring: string;
  iconColor: string;
  dotColor: string;
}> = {
  legendary: {
    gradient: "from-amber-400 via-orange-500 to-pink-500",
    border: "border-amber-400/60",
    shadow: "shadow-lg shadow-amber-400/30",
    glow: "animate-pulse",
    bg: "bg-gradient-to-br from-amber-950/60 to-amber-900/30",
    text: "text-amber-200",
    label: "Легендарное",
    badge: "bg-amber-500 text-amber-950",
    ring: "ring-amber-400/50",
    iconColor: "text-amber-400",
    dotColor: "bg-amber-400",
  },
  epic: {
    gradient: "from-purple-400 via-violet-500 to-fuchsia-500",
    border: "border-purple-400/50",
    shadow: "shadow-lg shadow-purple-400/25",
    glow: "",
    bg: "bg-gradient-to-br from-purple-950/50 to-purple-900/25",
    text: "text-purple-200",
    label: "Эпическое",
    badge: "bg-purple-500 text-white",
    ring: "ring-purple-400/40",
    iconColor: "text-purple-400",
    dotColor: "bg-purple-400",
  },
  rare: {
    gradient: "from-blue-400 via-cyan-500 to-teal-500",
    border: "border-blue-400/40",
    shadow: "shadow-md shadow-blue-400/20",
    glow: "",
    bg: "bg-gradient-to-br from-blue-950/40 to-blue-900/20",
    text: "text-blue-200",
    label: "Редкое",
    badge: "bg-blue-500 text-white",
    ring: "ring-blue-400/30",
    iconColor: "text-blue-400",
    dotColor: "bg-blue-400",
  },
  uncommon: {
    gradient: "from-green-400 via-emerald-500 to-teal-500",
    border: "border-green-400/30",
    shadow: "shadow-md shadow-green-400/15",
    glow: "",
    bg: "bg-gradient-to-br from-green-950/30 to-green-900/15",
    text: "text-green-200",
    label: "Необычное",
    badge: "bg-emerald-500 text-white",
    ring: "ring-green-400/20",
    iconColor: "text-green-400",
    dotColor: "bg-green-400",
  },
  common: {
    gradient: "from-sky-400 via-sky-500 to-indigo-500",
    border: "border-sky-400/30",
    shadow: "shadow-md shadow-sky-400/10",
    glow: "",
    bg: "bg-gradient-to-br from-sky-950/20 to-sky-900/10",
    text: "text-sky-200",
    label: "Обычное",
    badge: "bg-sky-500 text-white",
    ring: "ring-sky-400/20",
    iconColor: "text-sky-400",
    dotColor: "bg-sky-400",
  },
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
  const [isHovered, setIsHovered] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);

  const isLocked = achievement.locked === true;
  const isHidden = achievement.hidden === true && isLocked;
  const rarity = getDisplayRarity(achievement);
  const config = RARITY_CONFIG[rarity];
  const IconComponent = getAchievementIcon(achievement.icon);

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

  // Secret achievement: user must click to reveal
  if (isHidden && !isRevealing) {
    return (
      <div
        onClick={() => setIsRevealing(true)}
        className={cn(
          "p-4 border rounded-lg cursor-pointer select-none group",
          "bg-muted/50 border-dashed border-muted-foreground/30",
          "hover:bg-muted hover:border-muted-foreground/50 transition-all duration-300",
          "flex flex-col items-center justify-center gap-3 min-h-[130px]",
          compact && "min-h-[100px] p-3 gap-2"
        )}
      >
        <div className="relative">
          <div className={cn(
            "rounded-full bg-muted/50 p-3 ring-1 ring-muted-foreground/20",
            "group-hover:ring-amber-400/30 group-hover:bg-amber-950/20 transition-all duration-500"
          )}>
            <Sparkles className={cn(
              "text-muted-foreground/40 group-hover:text-amber-400/60 transition-colors",
              compact ? "w-6 h-6" : "w-8 h-8"
            )} />
          </div>
          <span className="absolute -top-1 -right-2 text-xl font-bold text-muted-foreground/50 group-hover:text-amber-400/70 transition-colors select-none">
            ?
          </span>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground font-medium">
            Секретное достижение
          </p>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
            Нажми, чтобы раскрыть
          </p>
        </div>
      </div>
    );
  }

  // Locked achievement (not yet earned)
  if (isLocked) {
    const firstLevel = levels.length > 0 ? levels[0] : null;
    const displayName = firstLevel?.name || achievement.name;
    const displayDesc = firstLevel?.description || achievement.description;

    return (
      <div
        className={cn(
          "p-4 border rounded-lg select-none transition-all duration-300",
          "bg-muted/30 border-muted-foreground/20 opacity-75 hover:opacity-90",
          "flex items-start gap-3 min-h-[90px]",
          compact && "p-3 gap-2 min-h-[70px]"
        )}
      >
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center ring-1 ring-muted-foreground/10">
          <IconComponent size={compact ? 16 : 20} className="text-muted-foreground/40" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={cn("font-semibold text-muted-foreground", compact ? "text-xs" : "text-sm")}>
              {displayName}
            </p>
            {maxLevel > 1 && (
              <span className="text-[10px] text-muted-foreground/50">
                {maxLevel} ур.
              </span>
            )}
          </div>
          <p className={cn("text-muted-foreground/50 truncate mt-0.5", compact ? "text-[10px]" : "text-xs")}>
            {displayDesc}
          </p>
          {/* Progress to first level */}
          {nextThreshold > 0 && (
            <div className="mt-2">
              <div className="h-1 bg-muted/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-muted-foreground/30 rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground/40 mt-0.5 text-right">
                {progressCurrent} / {nextThreshold}
              </p>
            </div>
          )}
          {/* Level dots preview for locked */}
          {maxLevel > 1 && (
            <div className="flex gap-1 mt-2">
              {Array.from({ length: maxLevel }).map((_, i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-muted-foreground/15"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // UNLOCKED achievement
  const levelDef = getCurrentLevelDef(achievement);
  const displayName = levelDef?.name || achievement.name;
  const displayDesc = levelDef?.description || achievement.description;

  // Progress to NEXT level
  const nextLevelDef = currentLevel < levels.length ? levels[currentLevel] : null;
  const nextLevelTarget = nextLevelDef?.threshold ?? 0;
  const nextLevelProgress = nextLevelTarget > 0
    ? Math.min(100, (progressCurrent / nextLevelTarget) * 100)
    : 100;

  // Reward info
  const rewardStr = levelDef?.reward_type === "garma"
    ? `+${levelDef.reward_value} gармы`
    : levelDef?.reward_type === "username_color"
    ? `Цвет ника: ${levelDef.reward_value}`
    : achievement.reward_type === "garma"
    ? `+${achievement.reward_value} gармы`
    : null;

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "relative p-4 border rounded-lg overflow-hidden",
        "transition-all duration-300 group",
        config.bg,
        config.border,
        config.shadow,
        isHovered && "scale-[1.02] -translate-y-0.5",
        compact && "p-3"
      )}
    >
      {/* Rarity glow animation */}
      {(rarity === "legendary" || rarity === "epic") && (
        <div
          className="absolute inset-0 opacity-15 animate-pulse pointer-events-none"
          style={{
            background: rarity === "legendary"
              ? "radial-gradient(circle at 50% 0%, rgba(251,191,36,0.35), transparent 70%)"
              : "radial-gradient(circle at 50% 0%, rgba(167,139,250,0.25), transparent 70%)",
          }}
        />
      )}

      {/* Rarity top bar gradient */}
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r",
          config.gradient
        )}
      />

      <div className="flex items-start gap-3 relative z-10">
        {/* Icon with rarity ring and level badge */}
        <div className="relative flex-shrink-0">
          <div
            className={cn(
              "w-11 h-11 rounded-xl flex items-center justify-center",
              "bg-gradient-to-br ring-2 transition-all duration-300",
              config.ring,
              isHovered && "scale-110",
              compact && "w-9 h-9 rounded-lg"
            )}
            style={{
              background: rarity === "legendary"
                ? "linear-gradient(135deg, rgba(251,191,36,0.3), rgba(249,115,22,0.2))"
                : rarity === "epic"
                ? "linear-gradient(135deg, rgba(167,139,250,0.3), rgba(139,92,246,0.2))"
                : rarity === "rare"
                ? "linear-gradient(135deg, rgba(96,165,250,0.3), rgba(45,212,191,0.2))"
                : rarity === "uncommon"
                ? "linear-gradient(135deg, rgba(74,222,128,0.3), rgba(45,212,191,0.2))"
                : "linear-gradient(135deg, rgba(56,189,248,0.2), rgba(99,102,241,0.15))",
            }}
          >
            <IconComponent size={compact ? 18 : 22} className={config.iconColor} />
          </div>
          {/* Level badge */}
          {currentLevel > 1 && (
            <div
              className={cn(
                "absolute -top-1.5 -right-1.5 min-w-[20px] h-5 rounded-full flex items-center justify-center",
                "text-[10px] font-bold text-white ring-2 ring-background",
                config.badge,
                compact && "min-w-[16px] h-4 text-[8px]"
              )}
            >
              {currentLevel}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={cn("font-bold truncate", config.text, compact ? "text-xs" : "text-sm")}>
              {displayName}
            </p>
            {/* Rarity badge */}
            <span
              className={cn(
                "text-[9px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wider",
                config.badge,
                compact && "hidden"
              )}
            >
              {config.label}
            </span>
            {/* Level counter */}
            {maxLevel > 1 && (
              <span className={cn("text-[10px] text-muted-foreground/50", compact && "hidden")}>
                {currentLevel}/{maxLevel}
              </span>
            )}
          </div>
          <p className={cn("text-muted-foreground mt-0.5", compact ? "text-[10px]" : "text-xs")}>
            {displayDesc}
          </p>

          {/* Progress to next level */}
          {nextLevelDef && currentLevel < maxLevel && (
            <div className="mt-2">
              <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700 ease-out",
                    "bg-gradient-to-r",
                    config.gradient
                  )}
                  style={{ width: `${nextLevelProgress}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5 text-right">
                {progressCurrent} / {nextLevelTarget} → ур. {currentLevel + 1}
              </p>
            </div>
          )}

          {/* Level dots */}
          {maxLevel > 1 && (
            <div className="flex gap-1 mt-2">
              {Array.from({ length: maxLevel }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-2 h-2 rounded-full transition-all duration-500",
                    i < currentLevel
                      ? cn("shadow-sm", config.dotColor)
                      : "bg-muted-foreground/15"
                  )}
                />
              ))}
            </div>
          )}

          {/* Unlock date */}
          {achievement.unlocked_at && !compact && (
            <p className="text-[10px] text-muted-foreground/40 mt-1.5">
              {new Date(achievement.unlocked_at).toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          )}
        </div>

        {/* Pin button */}
        {isEditing && onTogglePin && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(achievement.id);
            }}
            className={cn(
              "flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full",
              "bg-black/40 hover:bg-black/70 text-white transition-all",
              "opacity-0 group-hover:opacity-100 shadow-md",
              achievement.is_pinned && "opacity-100 bg-primary/60 hover:bg-primary/80"
            )}
            title={achievement.is_pinned ? "Открепить" : "Закрепить"}
          >
            {achievement.is_pinned ? (
              <PinOff className="w-3 h-3" />
            ) : (
              <Pin className="w-3 h-3" />
            )}
          </button>
        )}

        {/* Trophy for pinned */}
        {achievement.is_pinned && !isEditing && (
          <Trophy
            className={cn(
              "flex-shrink-0 w-4 h-4 text-amber-400/60",
              compact && "w-3 h-3"
            )}
          />
        )}
      </div>

      {/* Reward indicator */}
      {rewardStr && !compact && (
        <div className="mt-2.5 pt-2 border-t border-white/5">
          <span className="text-[10px] text-muted-foreground/60 font-medium">
            {rewardStr}
          </span>
        </div>
      )}
    </div>
  );
}
