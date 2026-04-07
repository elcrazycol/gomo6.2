import React from "react";
import { createHeadlessEditor } from "@lexical/headless";
import { $generateNodesFromDOM } from "@lexical/html";
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection } from "lexical";
import { LinkNode } from "@lexical/link";
import { CensorBlur } from "@/components/CensorBlur";
import { EmojiInline } from "@/components/EmojiInline";
import { MentionLink } from "@/components/MentionLink";
import { LinkButton } from "@/components/LinkButton";

export type LexicalJsonNode = {
  type: string;
  version?: number;
  children?: LexicalJsonNode[];
  text?: string;
  format?: number;
  style?: string;
  url?: string;
};

export type LexicalEditorStateJson = {
  root: LexicalJsonNode;
};

const EMPTY_PARAGRAPH_NODE: LexicalJsonNode = {
  children: [
    {
      type: "text",
      version: 1,
      // Zero-width space so Lexical 0.42+ does not treat the editor state as empty
      text: "\u200b",
      format: 0,
      style: "",
    },
  ],
  direction: null as unknown as never,
  format: "" as unknown as never,
  indent: 0 as unknown as never,
  textFormat: 0 as unknown as never,
  textStyle: "" as unknown as never,
  type: "paragraph",
  version: 1,
};

export const EMPTY_EDITOR_STATE: LexicalEditorStateJson = {
  root: {
    children: [EMPTY_PARAGRAPH_NODE],
    direction: null as unknown as never,
    format: "" as unknown as never,
    indent: 0 as unknown as never,
    type: "root",
    version: 1,
  },
};

const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 1 << 1;
const FORMAT_STRIKETHROUGH = 1 << 2;
const FORMAT_UNDERLINE = 1 << 3;

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
    [/\[blur\]/gi, '<span style="--gomo-blur:1">'],
    [/\[\/blur\]/gi, "</span>"],
    [/\[me\]/gi, '<span style="--gomo-me:1">'],
    [/\[\/me\]/gi, "</span>"],
    [/\[dude\]/gi, '<span style="--gomo-dude:1">'],
    [/\[\/dude\]/gi, "</span>"],
  ];

  for (const [pattern, replacement] of replacements) {
    html = html.replace(pattern, replacement);
  }

  html = html.replace(/\[col=([^\]]+)\]/gi, (_match, color) => `<span style="color:${String(color).trim()}">`);
  html = html.replace(/\[\/col\]/gi, "</span>");
  html = html.replace(/\[size=([^\]]+)\]/gi, (_match, value) => `<span style="font-size:${bbSizeToPx(String(value))}px">`);
  html = html.replace(/\[\/size\]/gi, "</span>");

  const lines = html.split("\n");
  return lines
    .map((line) => `<p>${line.length > 0 ? line : "<br>"}</p>`)
    .join("");
};

export const legacyContentToLexicalJson = (content: string): LexicalEditorStateJson => {
  if (typeof window === "undefined") {
    return {
      root: {
        type: "root",
        version: 1,
        children: [
          {
            type: "paragraph",
            version: 1,
            children: [{ type: "text", version: 1, text: content, format: 0, style: "" }],
          },
        ],
      },
    };
  }

  try {
    const editor = createHeadlessEditor({
      namespace: "gomo-legacy-import",
      nodes: [LinkNode],
      onError(error) {
        throw error;
      },
    });

    const parser = new DOMParser();
    const dom = parser.parseFromString(bbcodeToHtml(content), "text/html");
    let json = EMPTY_EDITOR_STATE;

    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const nodes = $generateNodesFromDOM(editor, dom);
      if (nodes.length === 0) {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(content));
        root.append(paragraph);
      } else {
        root.append(...nodes);
      }
      json = editor.getEditorState().toJSON() as LexicalEditorStateJson;
    });

    return json;
  } catch (error) {
    console.error("legacyContentToLexicalJson failed", error);
    return {
      root: {
        type: "root",
        version: 1,
        children: [
          {
            type: "paragraph",
            version: 1,
            children: [{ type: "text", version: 1, text: content, format: 0, style: "" }],
          },
        ],
      },
    };
  }
};

export const bbcodeToLexical = legacyContentToLexicalJson;

const isLexicalNodeJson = (node: unknown): node is LexicalJsonNode => {
  if (!node || typeof node !== "object") return false;

  const candidate = node as Record<string, unknown>;
  if (typeof candidate.type !== "string") return false;

  if ("children" in candidate && candidate.children != null) {
    if (!Array.isArray(candidate.children)) return false;
    if (!candidate.children.every((child) => isLexicalNodeJson(child))) return false;
  }

  return true;
};

const isLexicalEditorStateJson = (value: unknown): value is LexicalEditorStateJson => {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  if (!("root" in candidate) || !isLexicalNodeJson(candidate.root)) return false;

  return candidate.root.type === "root" && Array.isArray(candidate.root.children);
};

const coerceLexicalContentJson = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const ensureNonEmptyEditorState = (state: LexicalEditorStateJson): LexicalEditorStateJson => {
  const rootChildren = Array.isArray(state.root.children) ? state.root.children : [];

  if (rootChildren.length > 0) {
    return state;
  }

  return {
    root: {
      ...state.root,
      type: "root",
      version: state.root.version ?? 1,
      direction: ("direction" in state.root ? (state.root as Record<string, unknown>).direction : null) as never,
      format: ("format" in state.root ? (state.root as Record<string, unknown>).format : "") as never,
      indent: ("indent" in state.root ? (state.root as Record<string, unknown>).indent : 0) as never,
      children: [EMPTY_PARAGRAPH_NODE],
    },
  };
};

export const normalizeLexicalContent = (contentJson: unknown, legacyContent?: string | null): LexicalEditorStateJson => {
  // Handle null/undefined contentJson
  if (contentJson === null || contentJson === undefined) {
    if (legacyContent && legacyContent.trim().length > 0) {
      return legacyContentToLexicalJson(legacyContent);
    }
    return EMPTY_EDITOR_STATE;
  }

  const normalizedInput = coerceLexicalContentJson(contentJson);

  if (isLexicalEditorStateJson(normalizedInput)) {
    return ensureNonEmptyEditorState(normalizedInput);
  }
  if (legacyContent && legacyContent.trim().length > 0) {
    return legacyContentToLexicalJson(legacyContent);
  }
  return EMPTY_EDITOR_STATE;
};

export const lexicalJsonToPlainText = (contentJson: unknown, fallback = ""): string => {
  const walk = (node: LexicalJsonNode | undefined): string => {
    if (!node) return "";
    if (node.type === "text") return node.text || "";
    if (node.type === "linebreak") return "\n";
    const children = (node.children || []).map(walk).join("");
    if (node.type === "paragraph") return `${children}\n`;
    return children;
  };

  try {
    const normalizedInput = coerceLexicalContentJson(contentJson) as LexicalEditorStateJson | undefined;
    const root = normalizedInput?.root;
    const text = walk(root).replace(/\n{3,}/g, "\n\n").trimEnd();
    return text || fallback;
  } catch {
    return fallback;
  }
};

const styleStringToObject = (style = ""): React.CSSProperties => {
  const obj: Record<string, string> = {};
  for (const part of style.split(";")) {
    const [key, value] = part.split(":");
    if (!key || !value) continue;
    const trimmedKey = key.trim();
    if (!trimmedKey || trimmedKey.startsWith("--")) continue;
    const camelKey = key
      .trim()
      .replace(/-([a-z])/g, (_, char) => char.toUpperCase())
      .replace(/^\s+|\s+$/g, "");
    obj[camelKey] = value.trim();
  }
  return obj as React.CSSProperties;
};

const textToInlineNodes = (text: string, keyPrefix: string): React.ReactNode[] => {
  if (!text) return [];
  const regex = /(:[^:\s]+:|@[^\s]+|https?:\/\/[^\s]+)/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (!part) return null;
    if (part.startsWith(":") && part.endsWith(":") && part.length > 2) {
      return <EmojiInline key={key} code={part.slice(1, -1)} />;
    }
    if (part.startsWith("@")) {
      return <MentionLink key={key} username={part.slice(1)} />;
    }
    if (/^https?:\/\/[^\s]+$/.test(part)) {
      return <LinkButton key={key} url={part} />;
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  }).filter(Boolean);
};

const renderTextNode = (node: LexicalJsonNode, key: string): React.ReactNode => {
  const style = node.style || "";
  const css = styleStringToObject(style);
  const hasLegacySpoiler = style.includes("--gomo-spoiler:1");
  const hasBlur =
    style.includes("--gomo-blur:1") ||
    /(^|;)\s*(?:-webkit-)?filter\s*:\s*blur\(/i.test(style);
  const hasMeLink = style.includes("--gomo-me:1");
  const hasDudeLink = style.includes("--gomo-dude:1");
  const content = textToInlineNodes(node.text || "", key);
  const renderCss = { ...css };

  if (hasBlur) {
    for (const key of Object.keys(renderCss)) {
      const lowered = key.toLowerCase();
      if (
        lowered.includes("filter") ||
        lowered.includes("cursor") ||
        lowered.includes("transition") ||
        lowered.includes("background") ||
        lowered.includes("border") ||
        lowered.includes("padding") ||
        lowered.includes("borderradius")
      ) {
        delete renderCss[key as keyof typeof renderCss];
      }
    }
  }

  if (hasLegacySpoiler) {
    for (const key of Object.keys(renderCss)) {
      const lowered = key.toLowerCase();
      if (
        lowered.includes("background") ||
        lowered === "color" ||
        lowered.includes("borderradius") ||
        lowered.includes("cursor") ||
        lowered.includes("transition")
      ) {
        delete renderCss[key as keyof typeof renderCss];
      }
    }
  }

  let rendered: React.ReactNode = <>{content}</>;

  if ((node.format || 0) & FORMAT_BOLD) rendered = <strong>{rendered}</strong>;
  if ((node.format || 0) & FORMAT_ITALIC) rendered = <em>{rendered}</em>;
  if ((node.format || 0) & FORMAT_UNDERLINE) rendered = <u>{rendered}</u>;
  if ((node.format || 0) & FORMAT_STRIKETHROUGH) rendered = <s>{rendered}</s>;

  if (Object.keys(renderCss).length > 0) {
    rendered = <span style={renderCss}>{rendered}</span>;
  }

  if (hasMeLink || hasDudeLink) {
    rendered = <span className="font-bold text-quote">{rendered}</span>;
  }

  if (hasBlur) {
    rendered = <CensorBlur>{rendered}</CensorBlur>;
  }

  return <React.Fragment key={key}>{rendered}</React.Fragment>;
};

const renderNode = (node: LexicalJsonNode, key: string): React.ReactNode => {
  switch (node.type) {
    case "root":
      return <>{(node.children || []).map((child, index) => renderNode(child, `${key}-${index}`))}</>;
    case "paragraph": {
      const children = node.children || [];
      if (children.length === 0) return <div key={key} className="mb-2"><br /></div>;
      return <div key={key} className="mb-2">{children.map((child, index) => renderNode(child, `${key}-${index}`))}</div>;
    }
    case "linebreak":
      return <br key={key} />;
    case "link":
      return (
        <a key={key} href={node.url} target="_blank" rel="noreferrer" className="text-primary underline break-words">
          {(node.children || []).map((child, index) => renderNode(child, `${key}-${index}`))}
        </a>
      );
    case "text":
      return renderTextNode(node, key);
    default:
      return <React.Fragment key={key}>{(node.children || []).map((child, index) => renderNode(child, `${key}-${index}`))}</React.Fragment>;
  }
};

export const renderLexicalContent = (contentJson: unknown): React.ReactNode => {
  const state = normalizeLexicalContent(contentJson);
  return renderNode(state.root, "root");
};

export const insertTextAtSelection = (editor: { update: (fn: () => void) => void }, text: string) => {
  editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      selection.insertText(text);
    }
  });
};

export const isLegacyVisibilityContent = (content: string) =>
  content.includes("[seeusers=") || content.includes("[nousers=") || content.includes("[adm]") || content.includes("[me]") || content.includes("[dude]");
