import { useState } from "react";
import { cn } from "@/lib/utils";
import { Pin, PinOff, Sparkles, Lock, Trophy } from "lucide-react";

export interface AchievementData {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity?: "common" | "uncommon" | "rare" | "epic" | "legendary";
  level?: number;
  maxLevel?: number;
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
}

interface AchievementCardProps {
  achievement: AchievementData;
  onTogglePin?: (achievementId: string) => void;
  isEditing?: boolean;
  compact?: boolean;
}

const RARITY_CONFIG = {
  legendary: {
    gradient: "from-amber-400 via-orange-500 to-pink-500",
    border: "border-amber-400/60",
    shadow: "shadow-lg shadow-amber-400/30",
    glow: "animate-pulse",
    bg: "bg-gradient-to-br from-amber-950/60 to-amber-900/30",
    text: "text-amber-200",
    label: "Легендарное",
    badge: "bg-amber-500 text-amber-950",
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
  },
};

export function AchievementCard({
  achievement,
  onTogglePin,
  isEditing,
  compact,
}: AchievementCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);

  const rarity = achievement.rarity || "common";
  const config = RARITY_CONFIG[rarity];
  const isLocked = achievement.locked === true;
  const isHidden = achievement.hidden === true && !isLocked;

  // Secret achievement: user must click to reveal
  if (isHidden && !isRevealing) {
    return (
      <div
        onClick={() => setIsRevealing(true)}
        className={cn(
          "p-4 border rounded-lg cursor-pointer select-none",
          "bg-muted/50 border-dashed border-muted-foreground/30",
          "hover:bg-muted hover:border-muted-foreground/50 transition-all duration-300",
          "flex flex-col items-center justify-center gap-3 min-h-[100px]",
          compact && "min-h-[80px] p-3 gap-2"
        )}
      >
        <div className="relative">
          <Sparkles className={cn("text-muted-foreground/50", compact ? "w-6 h-6" : "w-8 h-8")} />
          <span className="absolute -top-1 -right-1 text-lg">❓</span>
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          Секретное достижение
        </span>
      </div>
    );
  }

  // Locked achievement (not yet earned)
  if (isLocked) {
    return (
      <div
        className={cn(
          "p-4 border rounded-lg select-none",
          "bg-muted/30 border-muted-foreground/20 opacity-60",
          "flex items-center gap-3 min-h-[80px]",
          compact && "p-3 gap-2 min-h-[60px]"
        )}
      >
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-muted flex items-center justify-center">
          <Lock className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn("font-semibold text-muted-foreground", compact ? "text-xs" : "text-sm")}>
            {achievement.name}
          </p>
          <p className={cn("text-muted-foreground/60 truncate", compact ? "text-[10px]" : "text-xs")}>
            {achievement.description}
          </p>
          {achievement.progress_target && achievement.progress_target > 0 && (
            <div className="mt-1.5">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-muted-foreground/30 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, ((achievement.progress_current || 0) / achievement.progress_target) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                {achievement.progress_current || 0} / {achievement.progress_target}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Progress calculation
  const progressPercent = achievement.progress_target && achievement.progress_target > 0
    ? Math.min(100, ((achievement.progress_current || 0) / achievement.progress_target) * 100)
    : 100;

  const level = achievement.level || 1;
  const maxLevel = achievement.maxLevel || 5;

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
      {rarity === "legendary" && (
        <div
          className="absolute inset-0 opacity-20 animate-pulse"
          style={{
            background: "radial-gradient(circle at 50% 0%, rgba(251,191,36,0.3), transparent 70%)",
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
        {/* Icon with rarity ring */}
        <div className="relative flex-shrink-0">
          <div
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center",
              "bg-gradient-to-br border-2",
              config.gradient,
              config.border,
              compact && "w-8 h-8"
            )}
          >
            <span className={cn("text-lg", compact && "text-base")}>
              {achievement.icon}
            </span>
          </div>
          {/* Level badge */}
          {level > 1 && (
            <div
              className={cn(
                "absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center",
                "text-[10px] font-bold text-white ring-2 ring-background",
                config.badge,
                compact && "w-4 h-4 text-[8px]"
              )}
            >
              {level}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={cn("font-bold truncate", config.text, compact ? "text-xs" : "text-sm")}>
              {achievement.name}
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
          </div>
          <p className={cn("text-muted-foreground mt-0.5", compact ? "text-[10px]" : "text-xs")}>
            {achievement.description}
          </p>

          {/* Progress bar for progressive achievements */}
          {achievement.achievement_type === "progressive" && progressPercent < 100 && (
            <div className="mt-2">
              <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700 ease-out",
                    "bg-gradient-to-r",
                    config.gradient
                  )}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                {achievement.progress_current || level} / {achievement.progress_target || maxLevel}
              </p>
            </div>
          )}

          {/* Level dots for progressive achievements */}
          {achievement.achievement_type === "progressive" && (achievement.maxLevel || 5) > 1 && (
            <div className="flex gap-1 mt-1.5">
              {Array.from({ length: achievement.maxLevel || 5 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-1.5 h-1.5 rounded-full transition-all duration-500",
                    i < level
                      ? cn("bg-gradient-to-r", config.gradient)
                      : "bg-muted-foreground/20"
                  )}
                />
              ))}
            </div>
          )}

          {/* Unlock date */}
          {achievement.unlocked_at && !compact && (
            <p className="text-[10px] text-muted-foreground/50 mt-1">
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

        {/* Trophy indicator for pinned achievements */}
        {achievement.is_pinned && !isEditing && (
          <Trophy
            className={cn(
              "flex-shrink-0 w-4 h-4",
              "text-amber-400/60",
              compact && "w-3 h-3"
            )}
          />
        )}
      </div>

      {/* Reward indicator */}
      {achievement.reward_type && !compact && (
        <div className="mt-2 pt-2 border-t border-border/30">
          <span className="text-[10px] text-muted-foreground/70">
            {achievement.reward_type === "garma" && `+${achievement.reward_value} gармы`}
            {achievement.reward_type === "username_color" &&
              `Цвет ника: ${achievement.reward_value}`}
          </span>
        </div>
      )}
    </div>
  );
}
