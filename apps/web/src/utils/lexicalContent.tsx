import React from "react";
import { createHeadlessEditor } from "@lexical/headless";
import { $generateNodesFromDOM } from "@lexical/html";
import { $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, TextNode } from "lexical";
import { LinkNode } from "@lexical/link";
import { BbCodeSpoiler } from "@/components/BbCodeSpoiler";
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

export const EMPTY_EDITOR_STATE: LexicalEditorStateJson = {
  root: {
    type: "root",
    version: 1,
    children: [
      {
        type: "paragraph",
        version: 1,
        children: [],
      },
    ],
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
    [/\[spoiler(?:=[^\]]+)?\]/gi, '<span style="--gomo-spoiler:1">'],
    [/\[\/spoiler\]/gi, "</span>"],
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

export const normalizeLexicalContent = (contentJson: unknown, legacyContent?: string | null): LexicalEditorStateJson => {
  if (contentJson && typeof contentJson === "object" && "root" in (contentJson as Record<string, unknown>)) {
    return contentJson as LexicalEditorStateJson;
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
    const root = (contentJson as LexicalEditorStateJson | undefined)?.root;
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
  const content = textToInlineNodes(node.text || "", key);

  let rendered: React.ReactNode = <>{content}</>;

  if ((node.format || 0) & FORMAT_BOLD) rendered = <strong>{rendered}</strong>;
  if ((node.format || 0) & FORMAT_ITALIC) rendered = <em>{rendered}</em>;
  if ((node.format || 0) & FORMAT_UNDERLINE) rendered = <u>{rendered}</u>;
  if ((node.format || 0) & FORMAT_STRIKETHROUGH) rendered = <s>{rendered}</s>;

  if (style.includes("--gomo-spoiler:1")) {
    return <BbCodeSpoiler key={key}>{rendered}</BbCodeSpoiler>;
  }

  if (style.includes("--gomo-blur:1")) {
    return <CensorBlur key={key}>{rendered}</CensorBlur>;
  }

  if (style.includes("--gomo-me:1") || style.includes("--gomo-dude:1")) {
    return <span key={key} className="font-bold text-quote">{rendered}</span>;
  }

  return <span key={key} style={css}>{rendered}</span>;
};

const renderNode = (node: LexicalJsonNode, key: string): React.ReactNode => {
  switch (node.type) {
    case "root":
      return <>{(node.children || []).map((child, index) => renderNode(child, `${key}-${index}`))}</>;
    case "paragraph": {
      const children = node.children || [];
      if (children.length === 0) return <p key={key}><br /></p>;
      return <p key={key}>{children.map((child, index) => renderNode(child, `${key}-${index}`))}</p>;
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

export class ExtendedTextNode extends TextNode {
  static getType() {
    return "text";
  }
  static clone(node: ExtendedTextNode) {
    return new ExtendedTextNode(node.__text, node.__key);
  }
}
