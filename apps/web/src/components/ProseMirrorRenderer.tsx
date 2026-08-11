import React from "react";
import { EmojiInline } from "@/components/EmojiInline";
import { CensorBlur } from "@/components/CensorBlur";
import { MentionLink } from "@/components/MentionLink";

interface ProsemirrorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProsemirrorNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

const renderInline = (node: ProsemirrorNode, key: string): React.ReactNode => {
  if (node.type !== "text" || !node.text) return null;

  let element: React.ReactNode = node.text;

  const marks = node.marks || [];
  let hasSpoiler = false;

  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        element = <strong>{element}</strong>;
        break;
      case "italic":
        element = <em>{element}</em>;
        break;
      case "underline":
        element = <u>{element}</u>;
        break;
      case "strike":
        element = <s>{element}</s>;
        break;
      case "link":
        element = (
          <a href={mark.attrs?.href as string || ""} target="_blank" rel="noreferrer" className="text-primary underline">
            {element}
          </a>
        );
        break;
      case "textStyle": {
        const style: React.CSSProperties = {};
        if (mark.attrs?.color) style.color = mark.attrs.color as string;
        if (mark.attrs?.fontSize) style.fontSize = mark.attrs.fontSize as string;
        if (Object.keys(style).length > 0) {
          element = <span style={style}>{element}</span>;
        }
        break;
      }
      case "spoiler":
        hasSpoiler = true;
        break;
      case "hashtag":
        element = <span className="text-primary font-semibold">{element}</span>;
        break;
    }
  }

  if (hasSpoiler) {
    element = <CensorBlur>{element}</CensorBlur>;
  }

  return <React.Fragment key={key}>{element}</React.Fragment>;
};

const isEmptyParagraph = (node: ProsemirrorNode): boolean => {
  if (node.type !== "paragraph") return false;
  const content = node.content || [];
  if (content.length === 0) return true;
  // Mirrors isEmptyProsemirrorNode: whitespace text and hard breaks count as
  // empty, so trailing paragraph leftovers are dropped consistently. Note:
  // String#trim does NOT remove \u200b (zero-width space is a Cf format char),
  // hence the explicit equality check.
  return content.every(
    (child) =>
      child.type === "hardBreak" ||
      (child.type === "text" &&
        (!child.text || child.text.trim().length === 0 || child.text === "\u200b")),
  );
};

const renderNode = (node: ProsemirrorNode, key: string): React.ReactNode => {
  if (node.type === "text") {
    return renderInline(node, key);
  }

  if (node.type === "hardBreak") {
    return <br key={key} />;
  }

  if (node.type === "customEmoji") {
    return <EmojiInline key={key} emojiId={node.attrs?.emojiId as string} />;
  }

  if (node.type === "mention") {
    const attrs = (node.attrs || {}) as { label?: string; id?: string };
    return <MentionLink key={key} username={attrs.label || attrs.id || ""} />;
  }

  const children = (node.content || [])
    .map((child, index) => renderNode(child, `${key}-${index}`))
    .filter(Boolean);

  switch (node.type) {
    case "doc": {
      // Drop trailing empty paragraphs (e.g. created by pressing Enter to
      // submit) so replies never show a stray blank line at the end.
      const nodes = node.content || [];
      let end = nodes.length;
      while (end > 0 && isEmptyParagraph(nodes[end - 1])) end--;
      return <>{nodes.slice(0, end).map((child, index) => renderNode(child, `${key}-${index}`))}</>;
    }
    case "paragraph":
      return (
        <div key={key} className="mb-2">
          {children.length > 0 ? children : <br />}
        </div>
      );
    default:
      return <React.Fragment key={key}>{children}</React.Fragment>;
  }
};

interface ProseMirrorRendererProps {
  json: ProsemirrorNode;
}

export const ProseMirrorRenderer = ({ json }: ProseMirrorRendererProps) => {
  return <>{renderNode(json, "root")}</>;
};
