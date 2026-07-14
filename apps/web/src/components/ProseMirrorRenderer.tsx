import React from "react";
import { EmojiInline } from "@/components/EmojiInline";
import { CensorBlur } from "@/components/CensorBlur";

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
    }
  }

  if (hasSpoiler) {
    element = <CensorBlur>{element}</CensorBlur>;
  }

  return <React.Fragment key={key}>{element}</React.Fragment>;
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

  const children = (node.content || [])
    .map((child, index) => renderNode(child, `${key}-${index}`))
    .filter(Boolean);

  switch (node.type) {
    case "doc":
      return <>{children}</>;
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
