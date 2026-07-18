const LEXICAL_FORMAT_BOLD = 1;
const LEXICAL_FORMAT_ITALIC = 1 << 1;
const LEXICAL_FORMAT_STRIKETHROUGH = 1 << 2;
const LEXICAL_FORMAT_UNDERLINE = 1 << 3;

const LEXICAL_FORMAT_MAP: Record<number, string> = {
  [LEXICAL_FORMAT_BOLD]: "bold",
  [LEXICAL_FORMAT_ITALIC]: "italic",
  [LEXICAL_FORMAT_STRIKETHROUGH]: "strike",
  [LEXICAL_FORMAT_UNDERLINE]: "underline",
};

export const parseLexicalFormat = (format: number): string[] => {
  if (!format) return [];
  return Object.entries(LEXICAL_FORMAT_MAP)
    .filter(([bit]) => format & Number(bit))
    .map(([, mark]) => mark);
};

const EMOJI_REGEX = /\[e:([a-f0-9-]{36})\]/g;

interface LexicalNode {
  type: string;
  version?: number;
  children?: LexicalNode[];
  text?: string;
  format?: number;
  style?: string;
  url?: string;
  direction?: string | null;
  indent?: number;
}

interface LexicalState {
  root: LexicalNode;
}

interface ProsemirrorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProsemirrorNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

const parseStyleString = (style = ""): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const part of style.split(";")) {
    const sep = part.indexOf(":");
    if (sep === -1) continue;
    const key = part.slice(0, sep).trim();
    const value = part.slice(sep + 1).trim();
    if (key && value) result[key] = value;
  }
  return result;
};

const isLexicalNode = (node: unknown): node is LexicalNode => {
  if (!node || typeof node !== "object") return false;
  const candidate = node as Record<string, unknown>;
  return typeof candidate.type === "string";
};

const convertLexicalText = (node: LexicalNode): ProsemirrorNode[] => {
  const text = node.text || "";
  if (!text) return [];

  const marks: ProsemirrorNode["marks"] = [];

  const formatMarks = parseLexicalFormat(node.format || 0);
  for (const mark of formatMarks) {
    marks.push({ type: mark });
  }

  if (node.style) {
    const style = parseStyleString(node.style);
    if (style["color"]) {
      marks.push({ type: "textStyle", attrs: { color: style["color"] } });
    }
    if (style["font-size"]) {
      marks.push({ type: "textStyle", attrs: { fontSize: style["font-size"] } });
    }
    if (style["--gomo-blur"] === "1" || style["filter"]?.includes("blur") || node.style?.includes("blur")) {
      marks.push({ type: "spoiler" });
    }
  }

  const segments = splitEmojiSegments(text);
  const result: ProsemirrorNode[] = [];

  for (const segment of segments) {
    if (segment.type === "emoji") {
      result.push({
        type: "customEmoji",
        attrs: { emojiId: segment.emojiId, url: null, name: null },
      });
    } else {
      result.push({
        type: "text",
        text: segment.text,
        marks: marks.length > 0 ? marks : undefined,
      });
    }
  }

  return result;
};

interface TextSegment {
  type: "text";
  text: string;
}

interface EmojiSegment {
  type: "emoji";
  emojiId: string;
}

type Segment = TextSegment | EmojiSegment;

const splitEmojiSegments = (text: string): Segment[] => {
  const segments: Segment[] = [];
  EMOJI_REGEX.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = EMOJI_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "emoji", emojiId: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }

  if (segments.length === 0 && text.length > 0) {
    segments.push({ type: "text", text });
  }

  return segments;
};

const convertLexicalNode = (node: LexicalNode): ProsemirrorNode | ProsemirrorNode[] | null => {
  if (!isLexicalNode(node)) return null;

  switch (node.type) {
    case "root": {
      const children = (node.children || [])
        .map(convertLexicalNode)
        .filter((n): n is ProsemirrorNode => n !== null);
      return { type: "doc", content: children.length > 0 ? children : [{ type: "paragraph" }] };
    }
    case "paragraph": {
      const children = (node.children || [])
        .flatMap(convertLexicalNode)
        .filter((n): n is ProsemirrorNode => n !== null);
      return { type: "paragraph", content: children.length > 0 ? children : undefined };
    }
    case "text": {
      return convertLexicalText(node);
    }
    case "linebreak": {
      return { type: "hardBreak" };
    }
    case "link": {
      const children = (node.children || [])
        .flatMap(convertLexicalNode)
        .filter((n): n is ProsemirrorNode => n !== null);
      const marks: ProsemirrorNode["marks"] = node.url
        ? [{ type: "link", attrs: { href: node.url } }]
        : [];
      return children.map((child) => {
        if (child.type === "text") {
          return { ...child, marks: [...(child.marks || []), ...marks] };
        }
        return child;
      });
    }
    default: {
      const children = (node.children || [])
        .flatMap(convertLexicalNode)
        .filter((n): n is ProsemirrorNode => n !== null);
      return children.length === 1 ? children[0] : { type: "paragraph", content: children };
    }
  }
};

export const lexicalToProsemirror = (lexicalJson: unknown): ProsemirrorNode | null => {
  if (!lexicalJson || typeof lexicalJson !== "object") return null;

  const state = lexicalJson as LexicalState;
  if (!state.root || state.root.type !== "root") return null;

  const result = convertLexicalNode(state.root);
  if (Array.isArray(result)) return result[0] || null;
  return result;
};

export const isProsemirrorJson = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === "doc" && Array.isArray(candidate.content);
};

export const isLexicalJson = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (!("root" in candidate)) return false;
  const root = candidate.root as Record<string, unknown>;
  return root?.type === "root" && Array.isArray(root?.children);
};

const isEmptyProsemirrorNode = (node: Record<string, unknown>): boolean => {
  if (node.type === "text") {
    const text = (node.text as string) || "";
    return text.trim().length === 0 || text === "\u200b";
  }
  if (node.type === "hardBreak") return true;
  if (node.type === "customEmoji") return false;
  if (node.type === "paragraph") {
    const content = node.content as Record<string, unknown>[] | undefined;
    if (!Array.isArray(content) || content.length === 0) return true;
    return content.every((child) => isEmptyProsemirrorNode(child));
  }
  const content = node.content as Record<string, unknown>[] | undefined;
  if (!Array.isArray(content)) return false;
  return content.every((child) => isEmptyProsemirrorNode(child));
};

export const isEmptyProsemirror = (value: unknown): boolean => {
  if (!isProsemirrorJson(value)) return false;
  const content = (value as { content?: Record<string, unknown>[] }).content;
  if (!Array.isArray(content) || content.length === 0) return true;
  return content.every((node) => isEmptyProsemirrorNode(node));
};

export const normalizeContent = (contentJson: unknown, legacyContent?: string | null): ProsemirrorNode | null => {
  const hasLegacyContent = typeof legacyContent === "string" && legacyContent.trim().length > 0;

  if (contentJson === null || contentJson === undefined) {
    if (!hasLegacyContent) return null;
    return legacyContentToProsemirrorJson(legacyContent);
  }

  if (isProsemirrorJson(contentJson)) {
    if (isEmptyProsemirror(contentJson) && hasLegacyContent) {
      return legacyContentToProsemirrorJson(legacyContent);
    }
    return contentJson as ProsemirrorNode;
  }

  if (isLexicalJson(contentJson)) {
    const converted = lexicalToProsemirror(contentJson);
    if (converted && !isEmptyProsemirror(converted)) {
      return converted;
    }
    if (hasLegacyContent) {
      return legacyContentToProsemirrorJson(legacyContent);
    }
    return converted;
  }

  if (typeof contentJson === "string") {
    const trimmed = contentJson.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (isProsemirrorJson(parsed)) {
          if (isEmptyProsemirror(parsed) && hasLegacyContent) {
            return legacyContentToProsemirrorJson(legacyContent);
          }
          return parsed;
        }
        if (isLexicalJson(parsed)) {
          const converted = lexicalToProsemirror(parsed);
          if (converted && !isEmptyProsemirror(converted)) {
            return converted;
          }
          if (hasLegacyContent) {
            return legacyContentToProsemirrorJson(legacyContent);
          }
          return converted;
        }
      } catch {
        // not JSON
      }
    }
    if (trimmed.length > 0) {
      return legacyContentToProsemirrorJson(trimmed);
    }
  }

  if (hasLegacyContent) {
    return legacyContentToProsemirrorJson(legacyContent);
  }

  return null;
};

export const prosemirrorToPlainText = (json: unknown, fallback = ""): string => {
  if (!json || typeof json !== "object") return fallback;

  const walk = (node: Record<string, unknown>): string => {
    if (node.type === "text") return (node.text as string) || "";
    if (node.type === "hardBreak") return "\n";
    if (node.type === "customEmoji") return "[e:" + ((node.attrs as Record<string, unknown>)?.emojiId || "") + "]";
    const children = (node.content as Record<string, unknown>[] || []).map(walk).join("");
    if (node.type === "paragraph") return children + "\n";
    return children;
  };

  try {
    const root = json as Record<string, unknown>;
    const text = walk(root).replace(/\n{3,}/g, "\n\n").trimEnd();
    return text || fallback;
  } catch {
    return fallback;
  }
};

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const bbSizeToPx = (value: string) => {
  const raw = Number.parseInt(value.trim(), 10);
  const clamped = Number.isFinite(raw) ? Math.min(7, Math.max(1, raw)) : 3;
  return 12 + clamped * 2;
};

const bbcodeToHtml = (content: string) => {
  let html = escapeHtml(content);
  html = html.replace(/\r\n/g, "\n");

  const replacements: Array<[RegExp, string]> = [
    [/\[b\]/gi, "<strong>"],
    [/\[\/b\]/gi, "</strong>"],
    [/\[i\]/gi, "<em>"],
    [/\[\/i\]/gi, "</em>"],
    [/\[u\]/gi, "<u>"],
    [/\[\/u\]/gi, "</u>"],
    [/\[s\]/gi, "<s>"],
    [/\[\/s\]/gi, "</s>"],
    [/\[br\]/gi, "<br>"],
    [/\[spoiler(?:=[^\]]+)?\]/gi, ""],
    [/\[\/spoiler\]/gi, ""],
    [/\[blur\]/gi, '<span data-spoiler="true">'],
    [/\[\/blur\]/gi, "</span>"],
  ];

  for (const [pattern, replacement] of replacements) {
    html = html.replace(pattern, replacement);
  }

  html = html.replace(/\[col=([^\]]+)\]/gi, (_match, color) => `<span style="color:${String(color).trim()}">`);
  html = html.replace(/\[\/col\]/gi, "</span>");
  html = html.replace(/\[size=([^\]]+)\]/gi, (_match, value) => `<span style="font-size:${bbSizeToPx(String(value))}px">`);
  html = html.replace(/\[\/size\]/gi, "</span>");

  const lines = html.split("\n");
  return lines.map((line) => `<p>${line.length > 0 ? line : "<br>"}</p>`).join("");
};

export const legacyContentToProsemirrorJson = (content: string): ProsemirrorNode | null => {
  if (typeof window === "undefined") {
    return {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: content }] }],
    };
  }

  try {
    const parser = new DOMParser();
    const dom = parser.parseFromString(`<div>${bbcodeToHtml(content)}</div>`, "text/html");
    const body = dom.body.firstElementChild || dom.body;
    const paragraphs: ProsemirrorNode[] = [];

    for (const child of Array.from(body.children)) {
      if (child.tagName === "P") {
        const contentNodes = convertDomChildren(child);
        paragraphs.push({
          type: "paragraph",
          content: contentNodes.length > 0 ? contentNodes : undefined,
        });
      } else {
        const contentNodes = convertDomChildren(child);
        if (contentNodes.length > 0) {
          paragraphs.push({ type: "paragraph", content: contentNodes });
        }
      }
    }

    return {
      type: "doc",
      content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph" }],
    };
  } catch (error) {
    console.error("legacyContentToProsemirrorJson failed", error);
    return {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: content }] }],
    };
  }
};

const convertDomChildren = (el: Element): ProsemirrorNode[] => {
  const nodes: ProsemirrorNode[] = [];

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || "";
      if (text) {
        nodes.push({ type: "text", text });
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as HTMLElement;
      const tag = element.tagName.toLowerCase();

      if (tag === "strong" || tag === "b") {
        const inner = convertDomChildren(element);
        for (const n of inner) {
          if (n.type === "text") {
            nodes.push({ ...n, marks: [...(n.marks || []), { type: "bold" }] });
          } else {
            nodes.push(n);
          }
        }
      } else if (tag === "em" || tag === "i") {
        const inner = convertDomChildren(element);
        for (const n of inner) {
          if (n.type === "text") {
            nodes.push({ ...n, marks: [...(n.marks || []), { type: "italic" }] });
          } else {
            nodes.push(n);
          }
        }
      } else if (tag === "u") {
        const inner = convertDomChildren(element);
        for (const n of inner) {
          if (n.type === "text") {
            nodes.push({ ...n, marks: [...(n.marks || []), { type: "underline" }] });
          } else {
            nodes.push(n);
          }
        }
      } else if (tag === "s" || tag === "strike" || tag === "del") {
        const inner = convertDomChildren(element);
        for (const n of inner) {
          if (n.type === "text") {
            nodes.push({ ...n, marks: [...(n.marks || []), { type: "strike" }] });
          } else {
            nodes.push(n);
          }
        }
      } else if (tag === "a") {
        const href = element.getAttribute("href") || "";
        const inner = convertDomChildren(element);
        for (const n of inner) {
          if (n.type === "text") {
            nodes.push({ ...n, marks: [...(n.marks || []), { type: "link", attrs: { href } }] });
          } else {
            nodes.push(n);
          }
        }
      } else if (tag === "br") {
        nodes.push({ type: "hardBreak" });
      } else if (tag === "span") {
        const style = element.getAttribute("style") || "";
        if (style.includes("blur") || element.hasAttribute("data-spoiler")) {
          const inner = convertDomChildren(element);
          for (const n of inner) {
            if (n.type === "text") {
              nodes.push({ ...n, marks: [...(n.marks || []), { type: "spoiler" }] });
            } else {
              nodes.push(n);
            }
          }
        } else if (style.includes("color:")) {
          const colorMatch = style.match(/color:\s*([^;]+)/);
          const color = colorMatch?.[1]?.trim();
          const inner = convertDomChildren(element);
          for (const n of inner) {
            if (n.type === "text" && color) {
              nodes.push({ ...n, marks: [...(n.marks || []), { type: "textStyle", attrs: { color } }] });
            } else {
              nodes.push(n);
            }
          }
        } else if (style.includes("font-size:")) {
          const sizeMatch = style.match(/font-size:\s*([^;]+)/);
          const fontSize = sizeMatch?.[1]?.trim();
          const inner = convertDomChildren(element);
          for (const n of inner) {
            if (n.type === "text" && fontSize) {
              nodes.push({ ...n, marks: [...(n.marks || []), { type: "textStyle", attrs: { fontSize } }] });
            } else {
              nodes.push(n);
            }
          }
        } else {
          nodes.push(...convertDomChildren(element));
        }
      } else {
        nodes.push(...convertDomChildren(element));
      }
    }
  }

  return nodes;
};
