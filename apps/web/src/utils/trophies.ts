/**
 * Trophy domain: the auto milestones (`user_achievements`) and the hand-granted
 * awards (`user_awards`) normalized into one render-ready shape.
 *
 * The catalog lives in Go (`apps/backend-go/internal/achievements`) and is
 * mirrored into the `achievements` table; this module only maps the API rows and
 * derives the display facts (artwork, owner share, tier) shared by the profile
 * trophy case and the full achievements page.
 */
import { getTrophyArt } from "@/components/trophyAssets";

/** Nature of a catalog entry. */
export type TrophyKind = "milestone" | "award";
/** Who owns the catalog row: the Go catalog or an admin-created award. */
export type TrophyOrigin = "code" | "admin";

/**
 * Glow tiers derived from the real owner share (not a stored label). Rarest
 * first; `common` is the fallback for a missing/unknown share.
 */
export type TrophyTier = "mythic" | "legendary" | "epic" | "rare" | "common";

/** Halo colour per tier, as an "r g b" triplet for the `--trophy-glow` var. */
export const TROPHY_TIER_GLOW: Record<TrophyTier, string> = {
  mythic: "244 63 94",
  legendary: "251 191 36",
  epic: "168 85 247",
  rare: "59 130 246",
  common: "148 163 184",
};

/** One step of a milestone (names/descriptions are i18n keys). */
export interface AchievementLevel {
  level: number;
  threshold: number;
  /** i18n key for the level name. */
  name_key?: string;
  /** i18n key for the level description. */
  description_key?: string;
  /** Legacy plain-text name (pre-i18n rows / tests). */
  name?: string;
  /** Legacy plain-text description. */
  description?: string;
}

/** Normalized milestone/trophy entry (auto). */
export interface AchievementData {
  id: string;
  group_key?: string;
  /** i18n key for the group title (new catalog), or plain text (admin). */
  title?: string;
  /** Legacy plain-text name / fallback. */
  name: string;
  description: string;
  icon: string;
  category: string;
  /** Whether this is an auto milestone or a hand-granted award. */
  kind?: TrophyKind;
  origin?: TrophyOrigin;
  /** Single/group artwork URL (admin-uploaded or curated). */
  image_url?: string | null;
  /** Per-level artwork: `{ "1": url, "2": url }`. */
  level_images?: Record<string, string>;
  /** Share of active owners per level, in percent: `{ "1": 3.42, "2": 1.1 }`. */
  owner_share?: Record<string, number>;
  level?: number;
  maxLevel?: number;
  max_level?: number;
  current_level?: number;
  unlocked_at?: string;
  locked?: boolean;
  levels?: AchievementLevel[];
}

/** Raw `user_achievements` join row (one per unlocked achievement). */
export interface UserAchievementRaw {
  current_level?: number;
  level?: number;
  unlocked_at?: string;
  achievements?: {
    id: string;
    group_key?: string;
    title?: string;
    name: string;
    description: string;
    icon?: string;
    category?: string;
    kind?: string;
    origin?: string;
    image_url?: string | null;
    level_images?: Record<string, string>;
    owner_share?: Record<string, number>;
    levels?: AchievementLevel[];
  };
}

/** Raw `user_awards` row with its embedded award definition. */
export interface UserAwardRaw {
  id: string;
  user_id?: string;
  award_key: string;
  awarded_by?: string | null;
  reason?: string;
  awarded_at: string;
  awarded_by_username?: string | null;
  award?: {
    id?: string;
    group_key?: string;
    title?: string;
    name?: string;
    description?: string;
    icon?: string;
    category?: string;
    origin?: string;
    image_url?: string | null;
    level_images?: Record<string, string>;
    owner_share?: Record<string, number>;
  } | null;
}

/** Normalized hand-granted award (one active grant, with its definition). */
export interface UserAward {
  id: string;
  awardKey: string;
  awardedBy: string | null;
  awardedByUsername: string | null;
  reason: string;
  awardedAt: string;
  title?: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  origin?: TrophyOrigin;
  imageUrl?: string | null;
  levelImages?: Record<string, string>;
  ownerShare?: Record<string, number>;
}

/**
 * One render-ready trophy: an unlocked milestone level or a hand-granted award,
 * carrying everything the card needs except localized text (resolved at render
 * time from `nameKey`/`titleKey`/`descriptionKey`).
 */
export interface Trophy {
  /** Stable React key: `a:<achievement id>` or `w:<grant id>`. */
  key: string;
  kind: TrophyKind;
  groupKey: string;
  achievementId?: string;
  awardId?: string;
  icon: string;
  /** Resolved artwork URL (per-level → group image → registry → null). */
  artUrl: string | null;
  level: number;
  maxLevel: number;
  /** i18n key for the current level name (milestones). */
  nameKey?: string;
  /** i18n key or plain text for the group/award title. */
  titleKey?: string;
  /** Plain-text fallback name. */
  name: string;
  /** i18n key for the current level description (milestones). */
  descriptionKey?: string;
  /** i18n key or plain text for the description fallback. */
  description: string;
  /** Share of active owners, in percent (0–100), or null when unknown. */
  ownerShare: number | null;
  tier: TrophyTier;
  unlockedAt?: string;
  /** Award-only: who granted it, why, and when. */
  grantedByUsername?: string | null;
  reason?: string;
  grantedAt?: string;
}

/** Minimal translator signature; matches the i18next `t` we pass in. */
export type TrophyTranslator = (key: string, options?: Record<string, unknown>) => string;

// ── Mapping ───────────────────────────────────────────────────────────────────

/** Map a raw user_achievements row to the AchievementData the UI renders. */
export function mapUserAchievementRaw(ua: UserAchievementRaw): AchievementData {
  const a = ua.achievements;
  if (!a) {
    return {
      id: "",
      name: "—",
      description: "",
      icon: "sparkles",
      category: "",
      level: 0,
      locked: true,
    };
  }
  const currentLevel = ua.current_level ?? ua.level ?? 0;
  const levels = a.levels || [];
  const levelDef =
    currentLevel > 0 && levels.length >= currentLevel ? levels[currentLevel - 1] : null;

  return {
    id: a.id || "",
    group_key: a.group_key,
    title: a.title,
    name: levelDef?.name || a.name || "—",
    description: levelDef?.description || a.description || "",
    icon: a.icon || "sparkles",
    category: a.category || "",
    kind: (a.kind as TrophyKind) || "milestone",
    origin: (a.origin as TrophyOrigin) || "code",
    image_url: a.image_url ?? null,
    level_images: a.level_images || {},
    owner_share: a.owner_share || {},
    level: currentLevel,
    current_level: currentLevel,
    maxLevel: levels.length || 1,
    max_level: levels.length || 1,
    unlocked_at: ua.unlocked_at,
    locked: currentLevel === 0,
    levels,
  };
}

/** Map a raw user_awards row to the normalized UserAward the UI renders. */
export function mapUserAwardRaw(ua: UserAwardRaw): UserAward {
  const a = ua.award || {};
  return {
    id: ua.id,
    awardKey: ua.award_key || a.group_key || "",
    awardedBy: ua.awarded_by ?? null,
    awardedByUsername: ua.awarded_by_username ?? null,
    reason: ua.reason ?? "",
    awardedAt: ua.awarded_at,
    title: a.title,
    name: a.name || a.title || ua.award_key || "—",
    description: a.description || "",
    icon: a.icon || "sparkles",
    category: a.category || "awards",
    origin: (a.origin as TrophyOrigin) || "code",
    imageUrl: a.image_url ?? null,
    levelImages: a.level_images || {},
    ownerShare: a.owner_share || {},
  };
}

// ── Derivation ────────────────────────────────────────────────────────────────

/**
 * Artwork URL for a trophy level, in priority order: the per-level upload, then
 * the group/single image, then the bundled frontend registry (fallback for code
 * milestones whose art ships with the app).
 */
export function trophyArt(
  groupKey: string | undefined,
  level: number,
  levelImages?: Record<string, string> | null,
  imageUrl?: string | null,
): string | null {
  if (groupKey && level > 0) {
    const perLevel = levelImages?.[String(level)];
    if (perLevel) return perLevel;
  }
  if (imageUrl) return imageUrl;
  return getTrophyArt(groupKey, level);
}

/** Owner share (percent) for a level, or null when unknown/not computed yet. */
export function ownerShareFor(
  ownerShare: Record<string, number> | null | undefined,
  level: number,
): number | null {
  if (!ownerShare || level <= 0) return null;
  const value = ownerShare[String(level)];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Map an owner share to a glow tier (rarest first). */
export function trophyTier(percent: number | null | undefined): TrophyTier {
  if (percent == null) return "common";
  if (percent < 1) return "mythic";
  if (percent < 3) return "legendary";
  if (percent < 10) return "epic";
  if (percent < 30) return "rare";
  return "common";
}

/** Format an owner share as a percentage with at most one decimal. */
export function formatOwnerShare(percent: number | null, locale?: string): string | null {
  if (percent == null) return null;
  return `${percent.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
}

/** Rarest first: lower share wins; unknown shares sort last. */
export function compareTrophiesRarestFirst(a: Trophy, b: Trophy): number {
  const pa = a.ownerShare;
  const pb = b.ownerShare;
  if (pa != null && pb != null && pa !== pb) return pa - pb;
  if (pa == null && pb != null) return 1;
  if (pa != null && pb == null) return -1;
  if (b.level !== a.level) return b.level - a.level;
  return (b.unlockedAt ?? "").localeCompare(a.unlockedAt ?? "");
}

/** Build a trophy from an unlocked milestone. */
export function trophyFromAchievement(a: AchievementData): Trophy {
  const level = a.level ?? a.current_level ?? 0;
  const levelDef = level > 0 ? a.levels?.[level - 1] : undefined;
  const groupKey = a.group_key ?? "";
  const share = ownerShareFor(a.owner_share, level);
  return {
    key: `a:${a.id}`,
    kind: "milestone",
    groupKey,
    achievementId: a.id,
    icon: a.icon,
    artUrl: trophyArt(groupKey, level, a.level_images, a.image_url),
    level,
    maxLevel: a.maxLevel ?? a.max_level ?? a.levels?.length ?? 1,
    nameKey: levelDef?.name_key,
    titleKey: a.title,
    name: a.name,
    descriptionKey: levelDef?.description_key,
    description: a.description,
    ownerShare: share,
    tier: trophyTier(share),
    unlockedAt: a.unlocked_at,
  };
}

/** Build a trophy from an active hand-granted award. */
export function trophyFromAward(w: UserAward): Trophy {
  const share = ownerShareFor(w.ownerShare, 1);
  return {
    key: `w:${w.id}`,
    kind: "award",
    groupKey: w.awardKey,
    awardId: w.id,
    icon: w.icon,
    artUrl: trophyArt(w.awardKey, 1, w.levelImages, w.imageUrl),
    level: 1,
    maxLevel: 1,
    titleKey: w.title,
    name: w.name,
    description: w.description,
    ownerShare: share,
    tier: trophyTier(share),
    unlockedAt: w.awardedAt,
    grantedByUsername: w.awardedByUsername,
    reason: w.reason,
    grantedAt: w.awardedAt,
  };
}

/** Merge unlocked milestones and active awards into one rarest-first list. */
export function buildTrophies(achievements: AchievementData[], awards: UserAward[]): Trophy[] {
  const milestoneTrophies = achievements
    .filter((a) => !a.locked && (a.level ?? a.current_level ?? 0) > 0)
    .map(trophyFromAchievement);
  return [...milestoneTrophies, ...awards.map(trophyFromAward)].sort(compareTrophiesRarestFirst);
}

// ── Localized text ────────────────────────────────────────────────────────────

/**
 * Localized trophy name. Tenure is the one dynamic series: its name is the term
 * on the site (half a year, then N full years), not a fixed catalog level.
 */
export function trophyName(t: TrophyTranslator, trophy: Trophy): string {
  if (trophy.kind === "milestone" && trophy.groupKey === "tenure" && trophy.level > 0) {
    return trophy.level === 1
      ? t("achievements.tenure.half")
      : t("achievements.tenure.years", { count: trophy.level - 1 });
  }
  if (trophy.nameKey) return t(trophy.nameKey);
  if (trophy.titleKey) return t(trophy.titleKey);
  return trophy.name;
}

/** Localized trophy description (level description → group/award description). */
export function trophyDescription(t: TrophyTranslator, trophy: Trophy): string {
  if (trophy.descriptionKey) return t(trophy.descriptionKey);
  return trophy.description ? t(trophy.description) : "";
}
