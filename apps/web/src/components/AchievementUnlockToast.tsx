import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Sparkles, X } from "lucide-react";

interface UnlockData {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
}

interface AchievementUnlockToastProps {
  achievement: UnlockData;
  onDismiss: () => void;
  autoDismissMs?: number;
}

const RARITY_COLORS: Record<string, string> = {
  legendary: "from-amber-400 via-orange-500 to-pink-500",
  epic: "from-purple-400 via-violet-500 to-fuchsia-500",
  rare: "from-blue-400 via-cyan-500 to-teal-500",
  uncommon: "from-green-400 via-emerald-500 to-teal-500",
  common: "from-gray-400 via-slate-500 to-zinc-500",
};

const RARITY_LABELS: Record<string, string> = {
  legendary: "ЛЕГЕНДАРНОЕ",
  epic: "ЭПИЧЕСКОЕ",
  rare: "РЕДКОЕ",
  uncommon: "НЕОБЫЧНОЕ",
  common: "ОБЫЧНОЕ",
};

export function AchievementUnlockToast({
  achievement,
  onDismiss,
  autoDismissMs = 6000,
}: AchievementUnlockToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setIsVisible(true));
    });

    // Auto dismiss
    const timer = setTimeout(() => {
      handleDismiss();
    }, autoDismissMs);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setIsLeaving(true);
    setTimeout(onDismiss, 400);
  };

  const isLegendary = achievement.rarity === "legendary";

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
        "transition-all duration-500 ease-out",
        isVisible && !isLeaving
          ? "translate-y-0 opacity-100 scale-100"
          : "translate-y-8 opacity-0 scale-95"
      )}
    >
      <div
        className={cn(
          "relative rounded-xl border overflow-hidden",
          "bg-background/95 backdrop-blur-sm shadow-2xl",
          "max-w-sm w-[90vw]",
          isLegendary && "border-amber-400/50 shadow-amber-400/20"
        )}
      >
        {/* Top gradient bar */}
        <div
          className={cn(
            "h-1 w-full bg-gradient-to-r",
            RARITY_COLORS[achievement.rarity]
          )}
        />

        {/* Legendary pulsing background */}
        {isLegendary && (
          <div
            className="absolute inset-0 opacity-10 animate-pulse pointer-events-none"
            style={{
              background: "radial-gradient(ellipse at 50% 0%, rgba(251,191,36,0.5), transparent 60%)",
            }}
          />
        )}

        <div className="p-4 relative z-10">
          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>

          {/* Header */}
          <div className="flex items-center gap-1.5 mb-3">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              Достижение открыто!
            </span>
          </div>

          {/* Achievement content */}
          <div className="flex items-center gap-3">
            {/* Icon */}
            <div
              className={cn(
                "flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center",
                "bg-gradient-to-br border-2",
                RARITY_COLORS[achievement.rarity]
              )}
            >
              <span className="text-2xl">{achievement.icon}</span>
            </div>

            <div className="min-w-0">
              <p className="font-bold text-sm truncate">{achievement.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {achievement.description}
              </p>
              <span
                className={cn(
                  "inline-block text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider mt-1.5",
                  "bg-gradient-to-r bg-clip-text text-transparent",
                  RARITY_COLORS[achievement.rarity]
                )}
              >
                {RARITY_LABELS[achievement.rarity]}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Queue manager for multiple simultaneous unlocks
const toastQueue: UnlockData[] = [];
let activeToast: UnlockData | null = null;
let onDismissCallback: (() => void) | null = null;

export function queueAchievementUnlock(achievement: UnlockData, onRender: (data: UnlockData) => void) {
  if (activeToast) {
    toastQueue.push(achievement);
  } else {
    activeToast = achievement;
    onRender(achievement);
    onDismissCallback = () => {
      activeToast = null;
      if (toastQueue.length > 0) {
        const next = toastQueue.shift()!;
        queueAchievementUnlock(next, onRender);
      }
    };
  }
}

export function getOnDismissCallback(): (() => void) | null {
  return onDismissCallback;
}
