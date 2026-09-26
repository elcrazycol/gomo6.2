/**
 * Trophy artwork registry (fallback).
 *
 * The achievement catalog (groups, levels, thresholds, text) lives in Go —
 * `apps/backend-go/internal/achievements` — and is mirrored into the DB. Artwork
 * is primarily DB-driven: `achievements.level_images[level]` (per-level uploads
 * from the admin panel) and `achievements.image_url`. This registry is only the
 * bundle-time fallback for code milestones that ship their art with the app; it
 * is consulted after the DB fields (see `utils/trophies.ts`).
 *
 * The artwork carries its own baked-in caption, so it is rendered as a whole
 * badge (no separate title/rarity text next to it).
 */
const TROPHY_ART: Record<string, Record<number, string>> = {
  entries: {
    1: "/trophies/entries-1.png",
    2: "/trophies/entries-2.png",
  },
  likes_received: {
    1: "/trophies/likes_received-1.png",
    2: "/trophies/likes_received-2.png",
  },
};

/**
 * Returns the trophy art URL for a group at a given level, or null when the
 * level has no artwork yet.
 */
export function getTrophyArt(
  groupKey?: string | null,
  level?: number | null,
): string | null {
  if (!groupKey || !level) return null;
  return TROPHY_ART[groupKey]?.[level] ?? null;
}
