import React from "react";
import { EmojiInline } from "@/components/EmojiInline";
import { CensorBlur } from "@/components/CensorBlur";
import { MentionLink } from "@/components/MentionLink";
import { MediaBlockRenderer } from "@/components/editor/media/MediaBlockView";
import { mediaGroupLayoutClass } from "@/components/editor/media/mediaLayout";
import { isZeroWidthText, toMediaBlockAttrs, toMediaGroupAttrs } from "@/components/editor/media/mediaSchema";

interface ProsemirrorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProsemirrorNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

const renderInline = (node: ProsemirrorNode, key: string): React.ReactNode => {
  if (node.type !== "text" || !node.text) return null;
  // Zero-width placeholders (the empty-editor sentinel) render as nothing so
  // they do not add a text line's leading around media.
  if (isZeroWidthText(node.text)) return null;

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
      // Drop leading AND trailing empty paragraphs: media inserted after an
      // Enter leaves a blank line that renders as a whole empty row above or
      // below the post (the "one line gap").
      const nodes = node.content || [];
      let start = 0;
      let end = nodes.length;
      while (start < end && isEmptyParagraph(nodes[start])) start++;
      while (end > start && isEmptyParagraph(nodes[end - 1])) end--;
      return <>{nodes.slice(start, end).map((child, index) => renderNode(child, `${key}-${index}`))}</>;
    }
    case "paragraph": {
      // A paragraph that is nothing but media should not add the text line's
      // leading: an inline-block image taller than the line box otherwise gets
      // an extra gap above and below it.
      const content = node.content || [];
      const mediaOnly =
        content.length > 0 &&
        content.every(
          (child) =>
            child.type === "mediaBlock" ||
            child.type === "mediaGroup" ||
            (child.type === "text" && isZeroWidthText(child.text)),
        );
      return (
        <div key={key} className={mediaOnly ? "leading-none" : "mb-2"}>
          {children.length > 0 ? children : <br />}
        </div>
      );
    }
    case "mediaBlock":
      return <MediaBlockRenderer key={key} attrs={toMediaBlockAttrs(node.attrs)} />;
    case "mediaGroup":
      return (
        <div key={key} data-media-group="true" className={mediaGroupLayoutClass(toMediaGroupAttrs(node.attrs).layout)}>
          {children}
        </div>
      );
    case "uploadPlaceholder":
      // Transient editor-only node: never persisted, nothing to render.
      return null;
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
