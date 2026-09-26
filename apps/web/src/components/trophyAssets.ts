/**
 * Trophy artwork registry.
 *
 * The achievement catalog (groups, levels, thresholds, text) lives in Go —
 * `apps/backend-go/internal/achievements` — and is mirrored into the DB. The
 * trophy artwork is, by contrast, a purely frontend asset: one hand-drawn PNG
 * per (group_key, level), served from `public/trophies/`.
 *
 * Keeping the map here means the backend never has to know about image paths,
 * and an achievement without artwork simply has no entry — the UI falls back to
 * the icon-only card. Add a level's art by dropping `<group_key>-<level>.png`
 * into `public/trophies/` and registering it below.
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
  daily_streak: { 1: "/trophies/daily_streak-1.png" },
  bio: { 1: "/trophies/bio-1.png" },
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
