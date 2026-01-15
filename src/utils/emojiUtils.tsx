import React from "react";
import { EmojiInline } from "@/components/EmojiInline";
import { LinkButton } from "@/components/LinkButton";
import { MentionLink } from "@/components/MentionLink";
import { CensorBlur } from "@/components/CensorBlur";

export const processEmojiText = (text: string, keyPrefix: string = 'emoji') => {
  let key = 0;

  // Split by all formatting including emojis, mentions, and URLs
  const regex = new RegExp(`(:[^:\\s]+:|@[^\\s]+|https?://[^\\s]+)`, 'g');
  const parts = text.split(regex);

  return parts.map((part, i) => {
    // Check for emojis
    if (part.startsWith(':') && part.endsWith(':') && part.length > 2) {
      const emojiCode = part.slice(1, -1); // Remove colons
      return (
        <EmojiInline key={`${keyPrefix}-${key++}-emoji-${i}`} code={emojiCode} />
      );
    }
    // Check for mentions
    else if (part.startsWith('@')) {
      const username = part.substring(1);
      return (
        <MentionLink key={`${keyPrefix}-${key++}-mention-${i}`} username={username} />
      );
    }
    // Check for URLs
    else if (part.match(/^https?:\/\/[^\s]+$/)) {
      return <LinkButton key={`${keyPrefix}-${key++}-link-${i}`} url={part} />;
    }

    return part;
  }).flat();
};

// Упрощенная версия renderContent из ProcessedContent для превью в textarea
export const renderPreviewContent = (text: string, keyPrefix: string = 'preview') => {
  const elements: React.ReactNode[] = [];
  let key = 0;

  const processLeafText = (segment: string) => {
    // Split by basic formatting: emojis, URLs
    const regex = new RegExp(`(:[^:\\s]+:|https?://[^\\s]+)`, 'g');
    const parts = segment.split(regex);
    return parts.map((part, i) => {
      if (part.startsWith(':') && part.endsWith(':') && part.length > 2) {
        const emojiCode = part.slice(1, -1);
        return <EmojiInline key={`${keyPrefix}-${key++}-emoji-${i}`} code={emojiCode} />;
      } else if (part.match(/^https?:\/\/[^\s]+$/)) {
        return <LinkButton key={`${keyPrefix}-${key++}-link-${i}`} url={part} />;
      }
      return part;
    }).flat();
  };

  type BbNode =
    | { type: "text"; value: string }
    | { type: "tag"; name: string; param?: string; children: BbNode[] };

  const parseBbInline = (input: string): BbNode[] => {
    const root: BbNode[] = [];
    const stack: Array<{ name: string; param?: string; children: BbNode[] }> = [];

    const pushNode = (n: BbNode) => {
      if (stack.length > 0) stack[stack.length - 1].children.push(n);
      else root.push(n);
    };

    const tagRe = /\[(\/?)(B|I|U|S|blur|col|size)(?:=([^\]]+))?\]/gi;
    let last = 0;
    let m: RegExpExecArray | null;

    while ((m = tagRe.exec(input)) !== null) {
      if (m.index > last) pushNode({ type: "text", value: input.slice(last, m.index) });
      const isClose = m[1] === "/";
      const name = (m[2] || "").toLowerCase();
      const param = m[3];

      if (!isClose) {
        stack.push({ name, param, children: [] });
      } else {
        let frameIdx = stack.length - 1;
        while (frameIdx >= 0 && stack[frameIdx].name !== name) frameIdx--;
        if (frameIdx >= 0) {
          const frame = stack.splice(frameIdx, 1)[0];
          const node: BbNode = { type: "tag", name: frame.name, param: frame.param, children: frame.children };
          if (stack.length > 0) stack[stack.length - 1].children.push(node);
          else root.push(node);
        } else {
          pushNode({ type: "text", value: m[0] });
        }
      }

      last = tagRe.lastIndex;
    }

    if (last < input.length) pushNode({ type: "text", value: input.slice(last) });
    while (stack.length > 0) {
      const frame = stack.shift()!;
      root.push({ type: "text", value: `[${frame.name}${frame.param ? "=" + frame.param : ""}]` });
      root.push(...frame.children);
    }
    return root;
  };

  const renderBbNodes = (nodes: BbNode[]): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    const renderChildren = (c: BbNode[]) => renderBbNodes(c);

    for (const n of nodes) {
      if (n.type === "text") {
        out.push(...processLeafText(n.value));
        continue;
      }

      const children = renderChildren(n.children);
      const name = n.name;

      if (name === "b") out.push(<strong key={`${keyPrefix}-${key++}-b`} className="font-bold">{children}</strong>);
      else if (name === "i") out.push(<em key={`${keyPrefix}-${key++}-i`} className="italic">{children}</em>);
      else if (name === "u") out.push(<u key={`${keyPrefix}-${key++}-u`}>{children}</u>);
      else if (name === "s") out.push(<s key={`${keyPrefix}-${key++}-s`}>{children}</s>);
      else if (name === "col") out.push(<span key={`${keyPrefix}-${key++}-col`} style={{ color: (n.param ?? "").trim() }}>{children}</span>);
      else if (name === "size") {
        const raw = parseInt((n.param ?? "").trim(), 10);
        const clamped = Number.isFinite(raw) ? Math.min(7, Math.max(1, raw)) : 3;
        const sizeEm = 0.75 + (clamped - 1) * 0.175;
        out.push(<span key={`${keyPrefix}-${key++}-size`} style={{ fontSize: `${sizeEm}em` }}>{children}</span>);
      } else if (name === "blur") {
        out.push(<CensorBlur key={`${keyPrefix}-${key++}-blur`}>{children}</CensorBlur>);
      } else {
        out.push(...children);
      }
    }

    return out;
  };

  elements.push(...renderBbNodes(parseBbInline(text)));

  return elements;
};