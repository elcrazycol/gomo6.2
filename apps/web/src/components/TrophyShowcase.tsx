import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AchievementData } from "@/components/AchievementCard";
import { getTrophyArt } from "@/components/trophyAssets";

/**
 * Rarity ordering for the showcase — rarest first. Unknown rarities sort last.
 */
const RARITY_RANK: Record<string, number> = {
  legendary: 5,
  epic: 4,
  rare: 3,
  uncommon: 2,
  common: 1,
};

/**
 * Hover-halo color per rarity, as an "r g b" triplet consumed by the CSS
 * `--trophy-glow` variable (see index.css).
 */
const RARITY_GLOW: Record<string, string> = {
  legendary: "251 191 36",
  epic: "168 85 247",
  rare: "59 130 246",
  uncommon: "16 185 129",
  common: "148 163 184",
};

function unlockedLevel(a: AchievementData): number {
  return a.level ?? a.current_level ?? 0;
}

function trophyArtFor(a: AchievementData): string | null {
  return getTrophyArt(a.group_key, unlockedLevel(a));
}

interface TrophyShowcaseProps {
  /** Unlocked achievements for the profile being viewed. */
  achievements: AchievementData[];
  className?: string;
}

/**
 * Trophy case shown on the profile achievements tab.
 *
 * Only achievements that have hand-drawn artwork are shown — the case is meant
 * to feel curated, so it grows as trophies are drawn rather than padding itself
 * with generic icon cards. Ordering is rarest first, then highest level, then
 * most recently unlocked.
 */
export function TrophyShowcase({ achievements, className }: TrophyShowcaseProps) {
  const { t } = useTranslation();

  const trophies = useMemo(
    () =>
      achievements
        .filter((a) => !a.locked && trophyArtFor(a) !== null)
        .sort((a, b) => {
          const byRarity =
            (RARITY_RANK[b.rarity ?? "common"] ?? 0) -
            (RARITY_RANK[a.rarity ?? "common"] ?? 0);
          if (byRarity !== 0) return byRarity;
          const byLevel = unlockedLevel(b) - unlockedLevel(a);
          if (byLevel !== 0) return byLevel;
          return (b.unlocked_at ?? "").localeCompare(a.unlocked_at ?? "");
        }),
    [achievements],
  );

  if (trophies.length === 0) return null;

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4 ${className ?? ""}`}>
      {trophies.map((a) => (
        <TrophyBadge key={a.id} achievement={a} src={trophyArtFor(a)!} label={trophyLabel(a, t)} />
      ))}
    </div>
  );
}

/** Localized level name for a trophy (the level, not the group), with fallbacks. */
function trophyLabel(a: AchievementData, t: (key: string) => string): string {
  const levelDef = a.levels?.[unlockedLevel(a) - 1];
  const key = levelDef?.name_key ?? a.title;
  if (key) return t(key);
  return a.name || "";
}

function TrophyBadge({
  achievement,
  src,
  label,
}: {
  achievement: AchievementData;
  src: string;
  label: string;
}) {
  const rarity = achievement.rarity ?? "common";
  const glow = RARITY_GLOW[rarity] ?? RARITY_GLOW.common;
  const name = label || achievement.name || achievement.title || "";

  // The glint is masked by the trophy PNG itself, so the light only ever
  // crosses the badge's own opaque pixels — the transparent background stays
  // untouched.
  const maskStyle: React.CSSProperties = {
    WebkitMaskImage: `url(${src})`,
    maskImage: `url(${src})`,
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
  };

  return (
    <div
      className="trophy-badge relative aspect-square select-none"
      style={{ "--trophy-glow": glow } as React.CSSProperties}
      title={name}
    >
      <img
        src={src}
        alt={name}
        loading="lazy"
        draggable={false}
        className="relative z-10 h-full w-full object-contain"
      />
      <span
        aria-hidden
        className="trophy-glint pointer-events-none absolute inset-0 z-20"
        style={maskStyle}
      />
    </div>
  );
}
