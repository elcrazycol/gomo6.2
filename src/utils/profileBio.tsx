import React from "react";
import { parseBbInline, type BbNode } from "./emojiUtils";
import { EmojiInline } from "@/components/EmojiInline";
import { LinkButton } from "@/components/LinkButton";
import { MentionLink } from "@/components/MentionLink";
import { CensorBlur } from "@/components/CensorBlur";

export const processProfileBio = (bio: string, keyPrefix: string = 'bio'): React.ReactNode[] => {
  if (!bio) return [];

  let key = 0;
  const elements: React.ReactNode[] = [];

  // Process emojis, mentions, and URLs first
  const processLeafText = (text: string): React.ReactNode[] => {
    const parts = text.split(/(:[^:\s]+:|@[^\s]+|https?:\/\/[^\s]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith(':') && part.endsWith(':') && part.length > 2) {
        const emojiCode = part.slice(1, -1);
        return <EmojiInline key={`${keyPrefix}-${key++}-emoji-${i}`} code={emojiCode} />;
      } else if (part.startsWith('@')) {
        const username = part.substring(1);
        return <MentionLink key={`${keyPrefix}-${key++}-mention-${i}`} username={username} />;
      } else if (part.match(/^https?:\/\/[^\s]+$/)) {
        return <LinkButton key={`${keyPrefix}-${key++}-link-${i}`} url={part} />;
      }
      return part;
    });
  };

  const renderBbNodes = (nodes: BbNode[]): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    const renderChildren = (c: BbNode[]) => renderBbNodes(c);

    for (const n of nodes) {
      if (n.type === "text") {
        out.push(...processLeafText(n.value || ""));
        continue;
      }

      const children = renderChildren(n.children);
      const name = n.name;

      if (name === "b") {
        out.push(<strong key={`${keyPrefix}-${key++}-b`} className="font-bold">{children}</strong>);
      } else if (name === "i") {
        out.push(<em key={`${keyPrefix}-${key++}-i`} className="italic">{children}</em>);
      } else if (name === "u") {
        out.push(<u key={`${keyPrefix}-${key++}-u`}>{children}</u>);
      } else if (name === "s") {
        out.push(<s key={`${keyPrefix}-${key++}-s`}>{children}</s>);
      } else if (name === "col") {
        out.push(<span key={`${keyPrefix}-${key++}-col`} style={{ color: (n.param ?? "").trim() }}>{children}</span>);
      } else if (name === "size") {
        const raw = parseInt((n.param ?? "").trim(), 10);
        const clamped = Number.isFinite(raw) ? Math.min(7, Math.max(1, raw)) : 3;
        const sizeEm = 0.75 + (clamped - 1) * 0.175;
        out.push(<span key={`${keyPrefix}-${key++}-size`} style={{ fontSize: `${sizeEm}em` }}>{children}</span>);
      } else if (name === "blur") {
        out.push(<CensorBlur key={`${keyPrefix}-${key++}-blur`}>{children}</CensorBlur>);
      } else if (name === "me") {
        // [me] tag - highlight for post author (in profile bio, just render normally)
        out.push(...children);
      } else if (name === "dude") {
        // [dude] tag - highlight for current user (in profile bio, just render normally)
        out.push(...children);
      } else {
        out.push(...children);
      }
    }

    return out;
  };

  elements.push(...renderBbNodes(parseBbInline(bio)));

  return elements;
};
