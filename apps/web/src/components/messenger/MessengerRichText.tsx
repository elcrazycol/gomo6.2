import { memo, useMemo, type ReactNode } from "react";
import { EmojiInline } from "@/components/EmojiInline";
import { CensorBlur } from "@/components/CensorBlur";
import { BbCodeSpoiler } from "@/components/BbCodeSpoiler";
import { parseMessageLinks, type LinkSegment } from "./MessageLinks";
import { LinkSegmentView } from "./MessageLinkViews";
import { sanitizeMessengerHref, sanitizeColor } from "./messengerRichTextUtils";

/**
 * Renders the messenger wire format (BBCode + [e:…] emoji tokens) back into
 * formatted content. Raw URLs inside plain text keep the rich link previews
 * (invite/thread/profile/board panels) via parseMessageLinks.
 *
 * The parser is deliberately lenient: unknown or unclosed tags render as
 * literal text — old plain-text messages must never look broken.
 */

type BBCodeNode =
  | { kind: "text"; text: string }
  | { kind: "emoji"; id: string }
  | { kind: "br" }
  | { kind: "tag"; name: string; attr: string; children: BBCodeNode[] };

// Open/close tags the renderer understands. Anything else stays literal.
const KNOWN_TAGS = new Set(["b", "i", "u", "s", "spoiler", "blur", "col", "size", "url", "br"]);

// Separator is "=" for attributes and ":" for emoji ids ([e:abc]).
const TOKEN_RE = /\[\/?(?:b|i|u|s|spoiler|blur|col|size|url|br|e)(?:[=:][^\]]*)?\]/g;

function parseBBCode(input: string): BBCodeNode[] {
  const root: BBCodeNode[] = [];
  const stack: Array<{ name: string; attr: string; children: BBCodeNode[] }> = [];
  const top = () => (stack.length > 0 ? stack[stack.length - 1].children : root);

  let cursor = 0;
  for (const match of input.matchAll(TOKEN_RE)) {
    const before = input.slice(cursor, match.index);
    if (before) top().push({ kind: "text", text: before });

    const token = match[0];
    if (token.startsWith("[/")) {
      const name = token.slice(2, -1).toLowerCase();
      let opened = -1;
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].name === name) {
          opened = i;
          break;
        }
      }
      if (opened >= 0) {
        // Close the innermost matching tag: pop everything above it into it.
        const closed = stack.splice(opened).reverse();
        const completed = stack.length > 0 ? stack[stack.length - 1].children : root;
        // closed[0] is the deepest tag; fold siblings upward.
        let folded: BBCodeNode = { kind: "tag", name: closed[0].name, attr: closed[0].attr, children: closed[0].children };
        for (const entry of closed.slice(1)) {
          const children = entry.children;
          children.push(folded);
          folded = { kind: "tag", name: entry.name, attr: entry.attr, children };
        }
        completed.push(folded);
      } else {
        top().push({ kind: "text", text: token });
      }
    } else {
      const inner = token.slice(1, -1); // e.g. "b", "col=#fff", "e:abc"
      const eq = inner.indexOf("=");
      const sep = eq >= 0 ? eq : inner.indexOf(":");
      const name = (sep >= 0 ? inner.slice(0, sep) : inner).toLowerCase();
      const attr = sep >= 0 ? inner.slice(sep + 1) : "";
      if (name === "e" && attr) {
        top().push({ kind: "emoji", id: attr });
      } else if (name === "br") {
        top().push({ kind: "br" });
      } else if (KNOWN_TAGS.has(name)) {
        stack.push({ name, attr, children: [] });
      } else {
        top().push({ kind: "text", text: token });
      }
    }

    cursor = match.index + token.length;
  }

  if (cursor < input.length) top().push({ kind: "text", text: input.slice(cursor) });

  // Unclosed tags → literal text. Extract every piece of content (text,
  // emoji tokens, nested tags) from the leftover stack so nothing is lost.
  const extractLiteral = (node: BBCodeNode): string => {
    switch (node.kind) {
      case "text": return node.text;
      case "emoji": return `[e:${node.id}]`;
      case "br": return "[br]";
      case "tag": {
        const inner = node.children.map(extractLiteral).join("");
        return `[${node.name}${node.attr ? `=${node.attr}` : ""}]${inner}[/${node.name}]`;
      }
    }
  };
  const leftover = stack.map((entry) =>
    ({ kind: "text" as const, text: extractLiteral({ kind: "tag", name: entry.name, attr: entry.attr, children: entry.children }) }),
  );
  return [...root, ...leftover];
}

const sizeToPx = (attr: string): number | null => {
  const trimmed = attr.trim();
  const px = Number.parseFloat(trimmed);
  if (!Number.isFinite(px) || px <= 0) return null;
  if (trimmed.endsWith("px") || px > 7) return Math.min(72, Math.round(px));
  return 12 + Math.round(px) * 2;
};

function TextLeaf({ text }: { text: string }) {
  const segments = useMemo<LinkSegment[]>(() => parseMessageLinks(text), [text]);
  if (segments.length === 1 && segments[0].type === "text") return <>{segments[0].content}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          <span key={index}>{segment.content}</span>
        ) : (
          <LinkSegmentView key={index} segment={segment} />
        ),
      )}
    </>
  );
}

function renderNode(node: BBCodeNode, key: number): ReactNode {
  switch (node.kind) {
    case "text":
      return <TextLeaf key={key} text={node.text} />;
    case "emoji":
      return <EmojiInline key={key} emojiId={node.id} />;
    case "br":
      return <br key={key} />;
    case "tag": {
      const children = node.children.map((child, index) => renderNode(child, index));
      switch (node.name) {
        case "b": return <strong key={key}>{children}</strong>;
        case "i": return <em key={key}>{children}</em>;
        case "u": return <u key={key}>{children}</u>;
        case "s": return <s key={key}>{children}</s>;
        case "spoiler": return <BbCodeSpoiler key={key} title={node.attr || null}>{children}</BbCodeSpoiler>;
        case "blur": return <CensorBlur key={key}>{children}</CensorBlur>;
        case "col": {
          const color = sanitizeColor(node.attr);
          return color ? <span key={key} style={{ color }}>{children}</span> : <span key={key}>{children}</span>;
        }
        case "size": {
          const px = sizeToPx(node.attr);
          return px ? <span key={key} style={{ fontSize: `${px}px` }}>{children}</span> : <span key={key}>{children}</span>;
        }
        case "url": {
          const href = sanitizeMessengerHref(node.attr);
          return href ? (
            <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="msg-link">
              {children}
            </a>
          ) : (
            <span key={key}>{children}</span>
          );
        }
        default:
          return <span key={key}>{children}</span>;
      }
    }
  }
}

export const MessengerRichText = memo(function MessengerRichText({ text }: { text: string }) {
  const nodes = useMemo(() => parseBBCode(text), [text]);
  return <>{nodes.map((node, index) => renderNode(node, index))}</>;
});
