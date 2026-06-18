// ─── URL parser for messenger messages ──────────────────────────────────────
// Splits message text into text/link segments. Internal links are detected
// for rich previews (invite, thread, profile, board). External links are
// rendered as plain clickable <a> tags.

export type LinkSegment =
  | { type: "text"; content: string }
  | { type: "link"; url: string; linkType: string; params: Record<string, string> };

// Domain regex — production + dev
const DOMAIN = `(?:https?:\\/\\/)?(?:localhost:\\d+|gomo6\\.wtf)`;

// Patterns ordered longest-first to avoid greedy matches
const PATTERNS: Array<{ type: string; regex: RegExp; extract: (m: RegExpMatchArray) => Record<string, string> }> = [
  {
    type: "invite",
    regex: new RegExp(`${DOMAIN}\\/g\\/([^/]+)\\/join\\/([^/\\s"')]+)`),
    extract: (m) => ({ slug: m[1], code: m[2] }),
  },
  {
    type: "thread",
    regex: new RegExp(`${DOMAIN}\\/(?:g\\/)?([^/]+)\\/thread\\/([^/\\s"')]+)`),
    extract: (m) => ({ slug: m[1], threadId: m[2] }),
  },
  {
    type: "profile",
    regex: new RegExp(`${DOMAIN}\\/profile\\/([^/\\s"')]+)`),
    extract: (m) => ({ userId: m[1] }),
  },
  {
    type: "board",
    regex: new RegExp(`${DOMAIN}\\/(?:g\\/)?([^/\\s"')]+)$`),
    extract: (m) => ({ slug: m[1] }),
  },
];

// Full URL regex for initial split (catches any URL-like token)
const URL_LIKE = /https?:\/\/[^\s<>"')]+/g;

export function parseMessageLinks(content: string): LinkSegment[] {
  if (!content) return [];

  const segments: LinkSegment[] = [];
  let lastIndex = 0;

  // Find all URL-like tokens in the text
  const urlMatches = Array.from(content.matchAll(URL_LIKE));

  for (const match of urlMatches) {
    const url = match[0];
    const start = match.index!;

    // Text before this URL
    if (start > lastIndex) {
      segments.push({ type: "text", content: content.slice(lastIndex, start) });
    }

    // Try internal patterns (longest first)
    let matched = false;
    for (const pattern of PATTERNS) {
      const m = url.match(pattern.regex);
      if (m) {
        segments.push({
          type: "link",
          url,
          linkType: pattern.type,
          params: pattern.extract(m),
        });
        matched = true;
        break;
      }
    }

    if (!matched) {
      // External link — only if starts with http(s)
      if (/^https?:\/\//.test(url)) {
        segments.push({ type: "link", url, linkType: "external", params: {} });
      } else {
        segments.push({ type: "text", content: url });
      }
    }

    lastIndex = start + url.length;
  }

  // Remaining text
  if (lastIndex < content.length) {
    segments.push({ type: "text", content: content.slice(lastIndex) });
  }

  return segments;
}
