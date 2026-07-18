export const EMPTY_EDITOR_STATE = {
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "\u200b" }] }],
};

interface ProsemirrorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProsemirrorNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export const isProsemirrorJson = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === "doc" && Array.isArray(candidate.content);
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
