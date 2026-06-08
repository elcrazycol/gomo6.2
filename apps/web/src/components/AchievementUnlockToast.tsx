import { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { Sparkles, X, Trophy, ArrowUp } from "lucide-react";
import { getAchievementIcon } from "@/components/AchievementIcons";

export interface UnlockData {
  id: string;
  group_key?: string;
  name: string;
  description: string;
  icon: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  level?: number;
  max_level?: number;
  is_first_time?: boolean;
  prev_level?: number;
}

interface AchievementUnlockToastProps {
  achievement: UnlockData;
  onDismiss: () => void;
  autoDismissMs?: number;
}

const RARITY_CONFIG: Record<string, {
  gradient: string;
  border: string;
  shadow: string;
  bg: string;
  text: string;
  label: string;
  badge: string;
  iconBg: string;
  dotActive: string;
  dotInactive: string;
  progressBar: string;
}> = {
  legendary: {
    gradient: "from-amber-400 via-orange-500 to-pink-500",
    border: "border-amber-400/40",
    shadow: "shadow-2xl shadow-amber-500/30",
    bg: "from-amber-950/98 via-orange-950/95 to-amber-900/98",
    text: "text-amber-100",
    label: "Легендарное",
    badge: "bg-amber-500/20 text-amber-300 border-amber-400/30",
    iconBg: "from-amber-500/30 to-orange-500/20 ring-amber-400/40",
    dotActive: "bg-amber-400 shadow-sm shadow-amber-400/50",
    dotInactive: "bg-white/10",
    progressBar: "from-amber-400 via-orange-500 to-pink-500",
  },
  epic: {
    gradient: "from-purple-400 via-violet-500 to-fuchsia-500",
    border: "border-purple-400/30",
    shadow: "shadow-2xl shadow-purple-500/25",
    bg: "from-purple-950/98 via-violet-950/95 to-purple-900/98",
    text: "text-purple-100",
    label: "Эпическое",
    badge: "bg-purple-500/20 text-purple-300 border-purple-400/30",
    iconBg: "from-purple-500/30 to-violet-500/20 ring-purple-400/30",
    dotActive: "bg-purple-400 shadow-sm shadow-purple-400/50",
    dotInactive: "bg-white/10",
    progressBar: "from-purple-400 via-violet-500 to-fuchsia-500",
  },
  rare: {
    gradient: "from-blue-400 via-cyan-500 to-teal-500",
    border: "border-blue-400/25",
    shadow: "shadow-2xl shadow-blue-500/20",
    bg: "from-blue-950/98 via-cyan-950/95 to-blue-900/98",
    text: "text-blue-100",
    label: "Редкое",
    badge: "bg-blue-500/20 text-blue-300 border-blue-400/30",
    iconBg: "from-blue-500/30 to-cyan-500/20 ring-blue-400/25",
    dotActive: "bg-blue-400 shadow-sm shadow-blue-400/50",
    dotInactive: "bg-white/10",
    progressBar: "from-blue-400 via-cyan-500 to-teal-500",
  },
  uncommon: {
    gradient: "from-green-400 via-emerald-500 to-teal-500",
    border: "border-green-400/25",
    shadow: "shadow-2xl shadow-green-500/15",
    bg: "from-green-950/98 via-emerald-950/95 to-green-900/98",
    text: "text-green-100",
    label: "Необычное",
    badge: "bg-green-500/20 text-green-300 border-green-400/30",
    iconBg: "from-green-500/30 to-emerald-500/20 ring-green-400/20",
    dotActive: "bg-green-400 shadow-sm shadow-green-400/50",
    dotInactive: "bg-white/10",
    progressBar: "from-green-400 via-emerald-500 to-teal-500",
  },
  common: {
    gradient: "from-sky-400 via-sky-500 to-indigo-500",
    border: "border-sky-400/20",
    shadow: "shadow-2xl shadow-sky-500/10",
    bg: "from-sky-950/98 via-sky-950/95 to-indigo-950/98",
    text: "text-sky-100",
    label: "Обычное",
    badge: "bg-sky-500/20 text-sky-300 border-sky-400/20",
    iconBg: "from-sky-500/25 to-indigo-500/20 ring-sky-400/15",
    dotActive: "bg-sky-400 shadow-sm shadow-sky-400/50",
    dotInactive: "bg-white/10",
    progressBar: "from-sky-400 via-sky-500 to-indigo-500",
  },
};

export function AchievementUnlockToast({
  achievement,
  onDismiss,
  autoDismissMs = 6000,
}: AchievementUnlockToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const rarity = achievement.rarity || "common";
  const config = RARITY_CONFIG[rarity];
  const level = achievement.level || 1;
  const maxLevel = achievement.max_level || 1;
  const isLevelUp = (achievement.prev_level || 0) > 0;
  const IconComponent = getAchievementIcon(achievement.icon);
  const isLegendary = rarity === "legendary";
  const isEpic = rarity === "epic";

  useEffect(() => {
    // Two-RAF trick for initial mount animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setIsVisible(true));
    });

    timerRef.current = setTimeout(() => {
      handleDismiss();
    }, autoDismissMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleDismiss = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsLeaving(true);
    setTimeout(onDismiss, 400);
  };

  return (
    <div
      className={cn(
        "fixed inset-x-0 z-[100] flex justify-center pointer-events-none",
        "bottom-4 sm:bottom-6 px-3 sm:px-0",
        "transition-all duration-500 ease-out",
        isVisible && !isLeaving
          ? "translate-y-0 opacity-100"
          : "translate-y-8 opacity-0"
      )}
    >
      {/* Toast card */}
      <div
        className={cn(
          "relative w-full sm:max-w-md rounded-2xl border overflow-hidden pointer-events-auto",
          "bg-gradient-to-b backdrop-blur-2xl",
          config.bg,
          config.border,
          config.shadow,
          isLegendary && "animate-pulse"
        )}
        style={isLegendary ? { animationDuration: "3s" } : undefined}
      >
        {/* Top gradient bar */}
        <div className={cn("h-1 w-full bg-gradient-to-r", config.gradient)} />

        {/* Ambient glow for legendary/epic */}
        {(isLegendary || isEpic) && (
          <div
            className="absolute inset-0 opacity-15 animate-pulse pointer-events-none"
            style={{
              background: `radial-gradient(ellipse at 50% 0%, currentColor, transparent 65%)`,
              animationDuration: isLegendary ? "2s" : "3s",
            }}
          />
        )}

        <div className="p-3.5 sm:p-5 relative z-10">
          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/15 transition-colors active:scale-90"
            aria-label="Закрыть"
          >
            <X className="w-3.5 h-3.5 text-white/40 hover:text-white/60" />
          </button>

          {/* Header badge */}
          <div className="flex items-center gap-2 mb-3">
            <div className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider",
              config.badge
            )}>
              <Sparkles className={cn("w-3 h-3", isLegendary && "animate-spin")} style={isLegendary ? { animationDuration: "3s" } : undefined} />
              <span>
                {isLevelUp ? "Уровень повышен!" : "Достижение открыто!"}
              </span>
            </div>
          </div>

          {/* Main content */}
          <div className="flex items-start gap-3 sm:gap-4">
            {/* Icon */}
            <div
              className={cn(
                "flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center",
                "bg-gradient-to-br ring-2",
                config.iconBg,
                isLegendary && "animate-pulse"
              )}
              style={isLegendary ? { animationDuration: "2.5s" } : undefined}
            >
              <IconComponent size={28} className="text-white drop-shadow-lg" />
            </div>

            <div className="min-w-0 flex-1">
              {/* Name + rarity */}
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <p className={cn("font-bold text-base sm:text-lg truncate leading-tight", config.text)}>
                  {achievement.name}
                </p>
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider border flex-shrink-0",
                  config.badge
                )}>
                  {config.label}
                </span>
              </div>

              {/* Description */}
              <p className="text-xs sm:text-sm text-white/55 leading-relaxed mt-0.5">
                {achievement.description}
              </p>

              {/* Level indicator — only for multi-level achievements */}
              {maxLevel > 1 && (
                <div className="mt-3 space-y-2">
                  {/* Level dots */}
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1" role="progressbar" aria-valuenow={level} aria-valuemin={0} aria-valuemax={maxLevel}>
                      {Array.from({ length: maxLevel }).map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            "w-2 h-2 rounded-full transition-all duration-500",
                            i < level ? config.dotActive : config.dotInactive
                          )}
                        />
                      ))}
                    </div>
                    <span className="text-[11px] text-white/45 font-medium tabular-nums">
                      {level}/{maxLevel}
                    </span>
                    {isLevelUp && (
                      <ArrowUp className="w-3.5 h-3.5 text-green-400 animate-bounce" />
                    )}
                  </div>

                  {/* Progress bar to next level */}
                  {level < maxLevel && (
                    <div className="h-1 bg-white/8 rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out", config.progressBar)}
                        style={{ width: `${(level / maxLevel) * 100}%` }}
                      />
                    </div>
                  )}

                  {/* Full bar when max level */}
                  {level >= maxLevel && (
                    <div className="h-1 bg-white/8 rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full bg-gradient-to-r", config.progressBar)} style={{ width: "100%" }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Bottom reward section */}
          <div className="mt-3 pt-3 border-t border-white/6 flex items-center gap-2">
            <Trophy className="w-3.5 h-3.5 text-amber-400/60" />
            <span className="text-[11px] text-white/35 font-medium">
              {maxLevel > 1 && level >= maxLevel
                ? "Все уровни открыты"
                : maxLevel > 1
                ? `Уровень ${level} из ${maxLevel}`
                : "Награда получена"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Queue manager ────────────────────────────────────────────

const toastQueue: UnlockData[] = [];
let activeToastId: string | null = null;
let queueProcessor: (() => void) | null = null;

/**
 * Queue an achievement for toast display.
 * If no toast is currently shown, display immediately.
 * Otherwise, enqueue and show after current toast dismisses.
 */
export function queueAchievementUnlock(
  achievement: UnlockData,
  onRender: (data: UnlockData) => void
) {
  // Deduplicate by group_key + level
  const dedupKey = `${achievement.group_key || achievement.id}:${achievement.level || 1}`;
  const activeKey = activeToastId;

  if (activeKey === dedupKey) return; // already showing this exact achievement

  // Check if already queued
  const alreadyQueued = toastQueue.some(
    (q) => `${q.group_key || q.id}:${q.level || 1}` === dedupKey
  );
  if (alreadyQueued) return;

  if (activeToastId !== null) {
    toastQueue.push(achievement);
  } else {
    activeToastId = dedupKey;
    onRender(achievement);
    queueProcessor = () => {
      activeToastId = null;
      queueProcessor = null;
      if (toastQueue.length > 0) {
        const next = toastQueue.shift()!;
        // Small delay between toasts for visual separation
        setTimeout(() => {
          queueAchievementUnlock(next, onRender);
        }, 500);
      }
    };
  }
}

/**
 * Called by the toast component when it dismisses.
 * Advances the queue to the next toast.
 */
export function advanceToastQueue(): void {
  if (queueProcessor) {
    const cb = queueProcessor;
    // Delay to let exit animation play
    setTimeout(cb, 450);
  } else {
    activeToastId = null;
  }
}

/**
 * Reset the queue (useful when user navigates away).
 */
export function clearToastQueue(): void {
  toastQueue.length = 0;
  activeToastId = null;
  queueProcessor = null;
}
