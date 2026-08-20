import { legacyContentToProsemirrorJson } from "@/utils/contentConverter";

/**
 * Messenger rich-text bridging.
 *
 * The messenger stores every message as a plain string. To give the composer
 * the same rich-editing experience as the wall (GomoRichEditor: inline emoji,
 * bold/italic/color/blur toolbar) the *draft* is authored in ProseMirror and
 * serialized back to a compact BBCode-ish wire format on every change:
 *
 *   • [b] [i] [u] [s] — text marks
 *   • [col=#rrggbb] [size=1-7] — text style (color / size)
 *   • [blur]…[/blur] — spoiler mark (the composer's "Спойлер (размытие)")
 *   • [url=https://…]text[/url] — links
 *   • [e:emojiId] — custom emoji (already the messenger's native token)
 *
 * The wire format is what travels through the API, gets E2E-encrypted for
 * notes, and is rendered back by MessengerRichText.
 */

interface ProsemirrorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProsemirrorNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

const EMOJI_RE = /\[e:([^\]]+)\]/g;
// A control-char pair that survives legacyContentToProsemirrorJson's
// HTML round-trip (escapeHtml only touches & < >) and cannot collide with
// user text.
const EMOJI_PLACEHOLDER_START = "\u0001";
const EMOJI_PLACEHOLDER_END = "\u0002";
// Control chars survive the BBCode→HTML round-trip and cannot collide with
// user text — they are swapped for customEmoji nodes right after parsing.
// eslint-disable-next-line no-control-regex
const PLACEHOLDER_RE = /[\u0001]([^\u0002]*)[\u0002]/g;

/** https://…, mailto:…, tel:… only — never javascript:/data:/. */
export function sanitizeMessengerHref(href: string): string {
  const trimmed = (href || "").trim();
  if (/^(https?|mailto|tel):/i.test(trimmed)) return trimmed;
  return "";
}

const MARK_ORDER = [
  "link",
  "textStyle",
  "spoiler",
  "strike",
  "underline",
  "italic",
  "bold",
] as const;

const wrapMark = (inner: string, mark: { type: string; attrs?: Record<string, unknown> }): string => {
  switch (mark.type) {
    case "bold": return `[b]${inner}[/b]`;
    case "italic": return `[i]${inner}[/i]`;
    case "underline": return `[u]${inner}[/u]`;
    case "strike": return `[s]${inner}[/s]`;
    // The composer's spoiler is an inline blur — serialize to [blur] so the
    // BBCode→PM converter (which only maps [blur] → spoiler mark) round-trips.
    case "spoiler": return `[blur]${inner}[/blur]`;
    case "link": {
      const href = sanitizeMessengerHref(String(mark.attrs?.href ?? ""));
      return href ? `[url=${href}]${inner}[/url]` : inner;
    }
    case "textStyle": {
      const color = mark.attrs?.color;
      if (typeof color === "string" && color) return `[col=${color}]${inner}[/col]`;
      const fontSize = mark.attrs?.fontSize;
      if (typeof fontSize === "string") {
        const px = Number.parseFloat(fontSize);
        if (Number.isFinite(px) && px > 0) {
          // bbSizeToPx(level) = 12 + level*2 → invert to keep round-trips stable.
          const level = Math.max(1, Math.min(7, Math.round((px - 12) / 2)));
          return `[size=${level}]${inner}[/size]`;
        }
      }
      return inner;
    }
    default:
      return inner;
  }
};

const applyMarks = (inner: string, marks: Array<{ type: string; attrs?: Record<string, unknown> }>): string => {
  const sorted = [...marks].sort(
    (a, b) => MARK_ORDER.indexOf(a.type as (typeof MARK_ORDER)[number]) - MARK_ORDER.indexOf(b.type as (typeof MARK_ORDER)[number]),
  );
  return sorted.reduce((acc, mark) => wrapMark(acc, mark), inner);
};

const markSignature = (marks: Array<{ type: string; attrs?: Record<string, unknown> }>): string =>
  JSON.stringify(
    [...marks]
      .sort((a, b) => MARK_ORDER.indexOf(a.type as (typeof MARK_ORDER)[number]) - MARK_ORDER.indexOf(b.type as (typeof MARK_ORDER)[number]))
      .map((mark) => [mark.type, mark.attrs ?? null]),
  );

const serializeLeaf = (node: ProsemirrorNode): string => {
  switch (node.type) {
    case "text": return node.text ?? "";
    case "customEmoji": return `[e:${String(node.attrs?.emojiId ?? "")}]`;
    case "mention": {
      const label = String(node.attrs?.label ?? node.attrs?.id ?? "");
      return `@${label}`;
    }
    case "hardBreak": return "\n";
    default: return "";
  }
};

/**
 * Serialize one run of sibling leaves. Marks shared by ALL of them wrap the
 * whole run once (so `[b]a [e:x] b[/b]` stays one bold block, not three), and
 * marks present on a single leaf wrap just that leaf (nested inside).
 */
const serializeRun = (
  nodes: ProsemirrorNode[],
  inherited: Array<{ type: string; attrs?: Record<string, unknown> }>,
): string => {
  if (nodes.length === 0) return "";
  const allMarks = nodes.map((node) => [...(node.marks ?? []), ...inherited]);
  // Intersection: marks every sibling shares.
  const base = allMarks[0].filter((mark) =>
    allMarks.every((marks) => marks.some((other) => markSignature([mark]) === markSignature([other]))),
  );
  const inner = nodes
    .map((node, index) => {
      const extra = allMarks[index].filter((mark) =>
        base.every((other) => markSignature([mark]) !== markSignature([other])),
      );
      const leaf = serializeLeaf(node);
      return extra.length > 0 ? applyMarks(leaf, extra) : leaf;
    })
    .join("");
  return base.length > 0 ? applyMarks(inner, base) : inner;
};

/**
 * PM JSON → messenger wire text. Custom emojis become [e:…] tokens, mentions
 * degrade to @label, and text marks are emitted as BBCode grouped by the
 * marks they actually share (compact output, stable round-trips).
 */
export function prosemirrorToMessengerText(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const doc = json as { content?: ProsemirrorNode[] };
  if (!Array.isArray(doc.content)) return "";

  let out = "";
  for (const block of doc.content) {
    out += serializeRun(block.content ?? [], []);
    out += "\n";
  }
  // Trim the trailing paragraph newline the same way prosemirrorToPlainText does.
  return out.replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
}

export const sanitizeColor = (value: string): string | null => {
  const trimmed = (value || "").trim();
  const hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex : null;
};

const LINK_RE = /\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/g;

/**
 * Split a text node by a /g pattern, preserving every occurrence. A cursor
 * walks the ORIGINAL string (never re-slicing the input), so the regex's
 * lastIndex stays valid across matches — the naive slice + re-exec pattern
 * loses every occurrence after the first.
 */
const splitTextBy = (
  textNode: ProsemirrorNode,
  re: RegExp,
  onMatch: (match: RegExpExecArray, marks: Array<{ type: string; attrs?: Record<string, unknown> }>) => ProsemirrorNode[],
): ProsemirrorNode[] => {
  const text = textNode.text ?? "";
  re.lastIndex = 0;
  if (!re.test(text)) return [textNode];
  re.lastIndex = 0;
  const marks = textNode.marks;
  const parts: ProsemirrorNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const before = text.slice(cursor, match.index);
    if (before) parts.push({ ...textNode, text: before });
    parts.push(...onMatch(match, marks ?? []));
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ ...textNode, text: text.slice(cursor) });
  return parts;
};

const splitLinks = (textNode: ProsemirrorNode): ProsemirrorNode[] =>
  splitTextBy(textNode, LINK_RE, (match, marks) => {
    const href = sanitizeMessengerHref(match[1]);
    if (!href) return [{ ...textNode, text: match[0] }];
    return [{ type: "text", text: match[2], marks: [...marks, { type: "link", attrs: { href } }] }];
  });

const splitEmojis = (textNode: ProsemirrorNode): ProsemirrorNode[] =>
  splitTextBy(textNode, PLACEHOLDER_RE, (match) => [
    { type: "customEmoji", attrs: { emojiId: match[1], fallback: null, name: "" }, marks: textNode.marks },
  ]);

const walkReplace = (node: ProsemirrorNode, replace: (n: ProsemirrorNode) => ProsemirrorNode[]): ProsemirrorNode[] => {
  if (node.type === "text") return replace(node);
  const content = node.content ?? [];
  const nextContent: ProsemirrorNode[] = [];
  for (const child of content) {
    nextContent.push(...walkReplace(child, replace));
  }
  return [{ ...node, content: nextContent.length > 0 ? nextContent : undefined }];
};

/**
 * Messenger wire text → PM JSON. Reuses the site's BBCode→ProseMirror
 * converter (bold/italic/underline/strike/color/size/blur, paragraphs) and
 * adds the two messenger-specific pieces on top: [e:…] tokens become
 * customEmoji nodes and [url=…]…[/url] becomes a link mark.
 */
export function messengerTextToProsemirror(text: string): ProsemirrorNode | null {
  if (!text || typeof text !== "string") return null;
  const withEmojiPlaceholders = text.replace(EMOJI_RE, (_m, id) => `${EMOJI_PLACEHOLDER_START}${id}${EMOJI_PLACEHOLDER_END}`);
  const doc = legacyContentToProsemirrorJson(withEmojiPlaceholders);
  if (!doc || !Array.isArray(doc.content)) return doc;

  let next = doc;
  next = walkReplace(next, splitLinks)[0];
  next = walkReplace(next, splitEmojis)[0];

  // Drop paragraphs that became completely empty after token expansion (the
  // zero-width sentinel + empty emoji-only paragraph case).
  const content = (next.content ?? []).map((paragraph) => {
    if (paragraph.type !== "paragraph") return paragraph;
    const inner = paragraph.content ?? [];
    if (inner.length === 0) return paragraph;
    const meaningful = inner.filter((child) => {
      if (child.type === "customEmoji" || child.type === "mention") return true;
      if (child.type === "text") {
        const t = child.text ?? "";
        return t.replace(/\u200b/g, "").trim().length > 0;
      }
      return true;
    });
    return meaningful.length > 0 ? paragraph : { ...paragraph, content: undefined };
  });

  return { ...next, content };
}

/**
 * Strip every BBCode tag and emoji token → plain readable text. Emojis count
 * as one character (◆) so content detection and the char counter stay in sync
 * with the editor's CharacterCount (which counts each emoji as 1).
 */
export function messengerTextToPlain(text: string): string {
  if (!text) return "";
  return text
    .replace(EMOJI_RE, "◆")
    .replace(/\[[\]/]?(?:b|i|u|s|spoiler|blur|col|size|url)(?:=[^\]]*)?\]/gi, "")
    .replace(/\u200b/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Server-truncated previews (80 chars of raw wire text) can end mid-tag. The
 * truncation only ever cuts a suffix, so a single dangling-fragment strip of
 * KNOWN tag starts — opening or closing — is enough to clean `[col=#ff00`,
 * `[e:abc`, `[/b`, `[/url` etc. Arbitrary `[text` is kept: it may be
 * legitimate user content. Only preview helpers use this — the emptiness
 * check (messengerTextToPlain) must never treat a draft like `[b` as empty.
 */
export function stripDanglingTagFragment(text: string): string {
  if (!text) return text;
  return text.replace(/\[\/?(?:e:|b|i|u|s|spoiler|blur|col|size|url)[^\]]*$/i, "");
}

/** Whether the wire text carries any meaningful content (emoji counts). */
export function isMessengerTextEmpty(text: string): boolean {
  return messengerTextToPlain(text).length === 0;
}

/**
 * Short plain preview for quotes / pinned banners — no BBCode, no emoji
 * tokens, truncated at a word boundary.
 */
export function messengerPlainPreview(text: string, maxLength = 100): string {
  // Special message tokens render as rich cards — never leak the raw token
  // into previews (conversation list, quoted bubbles, pinned banner).
  if (text.startsWith("__SHARE__")) return "🔗 Поделился записью";
  if (text.startsWith("__GIFT__")) return "🎁 Подарок";
  const withoutEmojis = stripDanglingTagFragment(text).replace(EMOJI_RE, " ");
  const plain = messengerTextToPlain(withoutEmojis);
  if (plain.length <= maxLength) return plain;
  const cut = plain.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > maxLength * 0.6 ? lastSpace : maxLength).trimEnd()}…`;
}

/**
 * Clipboard-friendly copy: formatting tags stripped, but [e:…] emoji tokens
 * kept — pasting the text back into the messenger re-renders the emojis.
 */
export function messengerTextToCopy(text: string): string {
  if (!text) return "";
  return text
    .replace(/\[[\]/]?(?:b|i|u|s|spoiler|blur|col|size|url)(?:=[^\]]*)?\]/gi, "")
    .replace(/\u200b/g, "");
}
