// ─── Share token utilities ─────────────────────────────────────────────────
// A "share" is encoded as a content token inside a messenger message
// (__SHARE__:<type>:<id>), following the existing __GIFT__ pattern. The
// client renders a rich card by fetching the entity data; the token itself is
// small, survives server-side preview truncation, and needs no backend schema
// changes.

export type ShareTargetType = "thread" | "wall";

export interface ShareTarget {
  type: ShareTargetType;
  id: string;
}

export const SHARE_TOKEN_PREFIX = "__SHARE__";

/** Build the wire token embedded in a chat message's content. */
export function buildShareToken(target: ShareTarget): string {
  return `${SHARE_TOKEN_PREFIX}:${target.type}:${target.id}`;
}

const SHARE_TOKEN_RE = /^__SHARE__:(thread|wall):([A-Za-z0-9-]+)$/;

/**
 * Parse a message content into a ShareTarget, or null when the content is not
 * a share token (the regex is anchored, so a user-typed phrase containing
 * "__SHARE__" mid-text never matches).
 */
export function parseShareToken(content: string): ShareTarget | null {
  if (!content || !content.startsWith(SHARE_TOKEN_PREFIX)) return null;
  const match = content.match(SHARE_TOKEN_RE);
  if (!match) return null;
  return { type: match[1] as ShareTargetType, id: match[2] };
}
