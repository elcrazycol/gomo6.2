import { useEffect } from 'react';
import { useEmojiData } from '@/contexts/EmojiDataContext';
import { storageUrl } from '@/utils/storage';

interface EmojiInlineProps {
  emojiId?: string;
  code?: string;
  className?: string;
  size?: number;
}

/**
 * Renders a custom emoji by id, resolving it lazily through the shared emoji
 * data context. The effect re-runs whenever `resolveEmojis` changes identity
 * (i.e. whenever the emoji map grows), so an emoji that was unknown at first
 * paint renders the instant its record arrives — no permanent [?] placeholders.
 */
export const EmojiInline = ({ emojiId, code, className = "", size }: EmojiInlineProps) => {
  const { allEmojis, resolveEmojis } = useEmojiData();

  const emoji = emojiId ? allEmojis.get(emojiId) : undefined;

  useEffect(() => {
    if (emojiId && !emoji) {
      resolveEmojis([emojiId]);
    }
  }, [emojiId, emoji, resolveEmojis]);

  // New system: render by emojiId
  if (emoji && emojiId) {
    const url = storageUrl('emojis', emoji.image_url);
    const style = size ? { width: size, height: size } : undefined;

    return (
      <img
        src={url}
        alt={emoji.name}
        className={`inline-block align-middle mx-0.5 ${className}`}
        style={style || { height: '1.2em', width: 'auto' }}
        draggable={false}
      />
    );
  }

  // Legacy fallback: show code as text (old emoji system was never functional)
  if (code) {
    return <span className={`text-muted-foreground text-xs ${className}`}>:{code}:</span>;
  }

  // Unknown or still resolving: a neutral inline placeholder instead of a raw
  // [?] — the record arrives via resolveEmojis and replaces it moments later.
  if (emojiId) {
    return (
      <span
        data-testid="emoji-inline-placeholder"
        className={`inline-block h-[1.2em] w-[1.2em] rounded bg-muted/40 align-middle ${className}`}
        aria-hidden="true"
      />
    );
  }

  return null;
};
