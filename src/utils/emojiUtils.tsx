import React from "react";
import { EmojiInline } from "@/components/EmojiInline";
import { LinkButton } from "@/components/LinkButton";
import { MentionLink } from "@/components/MentionLink";

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

  const processTextSegment = (segment: string) => {
    // Split by basic formatting: emojis, bold, italic, URLs (no mentions in preview)
    const regex = new RegExp(`(:[^:\\s]+:|\\*\\*.*?\\*\\*|\\*.*?\\*|https?://[^\\s]+)`, 'g');
    const parts = segment.split(regex);
    return parts.map((part, i) => {
      // Check for emojis
      if (part.startsWith(':') && part.endsWith(':') && part.length > 2) {
        const emojiCode = part.slice(1, -1); // Remove colons
        return (
          <EmojiInline key={`${keyPrefix}-${key++}-emoji-${i}`} code={emojiCode} />
        );
      }
      // Check for bold text
      else if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={`${keyPrefix}-${key++}-bold-${i}`} className="font-bold">
            {part.slice(2, -2)}
          </strong>
        );
      }
      // Check for italic text
      else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
        return (
          <em key={`${keyPrefix}-${key++}-italic-${i}`} className="italic">
            {part.slice(1, -1)}
          </em>
        );
      }
      // Check for URLs
      else if (part.match(/^https?:\/\/[^\s]+$/)) {
        return (
          <LinkButton key={`${keyPrefix}-${key++}-link-${i}`} url={part} />
        );
      }
      return part;
    }).flat();
  };

  // Process the entire text
  elements.push(...processTextSegment(text));

  return elements;
};