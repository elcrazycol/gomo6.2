import React from "react";
import { renderBbCode } from "./bbcodePlugins";

// Process emoji text (simplified version for emoji-only processing)
export const processEmojiText = (text: string, keyPrefix: string = 'emoji') => {
  if (!text) return [];
  const rendered = renderBbCode(text, { keyPrefix });
  return React.Children.toArray(rendered);
};

// Render preview content with BB code support
export const renderPreviewContent = (text: string, keyPrefix: string = 'preview'): React.ReactNode => {
  if (!text) return null;
  return renderBbCode(text, { keyPrefix });
};
