import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { TrophyCard } from "@/components/TrophyCard";
import type { Trophy } from "@/utils/trophies";

interface TrophyShowcaseProps {
  /** The user's trophies (milestones + awards), already sorted rarest first. */
  trophies: Trophy[];
  /** Cap the case to the N rarest — the full list lives on the achievements page. */
  limit?: number;
  className?: string;
}

/**
 * Compact trophy case for the profile achievements tab: the rarest trophies,
 * including hand-granted awards, with their real owner share. The full hall lives
 * on /achievements/:userId.
 */
export function TrophyShowcase({ trophies, limit = 8, className }: TrophyShowcaseProps) {
  const shown = useMemo(() => trophies.slice(0, limit), [trophies, limit]);

  if (shown.length === 0) return null;

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4",
        className,
      )}
    >
      {shown.map((trophy) => (
        <TrophyCard key={trophy.key} trophy={trophy} />
      ))}
    </div>
  );
}
