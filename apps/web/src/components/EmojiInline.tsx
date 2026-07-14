import { useEffect, useState } from 'react';
import { useEmojiData } from '@/contexts/EmojiDataContext';
import { storageUrl } from '@/utils/storage';

interface EmojiInlineProps {
  emojiId?: string;
  code?: string;
  className?: string;
  size?: number;
}

export const EmojiInline = ({ emojiId, code, className = "", size }: EmojiInlineProps) => {
  const { allEmojis, resolveEmojis } = useEmojiData();
  const [resolved, setResolved] = useState(false);

  const emoji = emojiId ? allEmojis.get(emojiId) : undefined;

  useEffect(() => {
    if (emojiId && !emoji && !resolved) {
      resolveEmojis([emojiId]).then(() => setResolved(true));
    }
  }, [emojiId, emoji, resolveEmojis, resolved]);

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
        title={`:${emoji.name}:`}
        draggable={false}
      />
    );
  }

  // Legacy fallback: show code as text (old emoji system was never functional)
  if (code) {
    return <span className={`text-muted-foreground text-xs ${className}`}>:{code}:</span>;
  }

  // Loading state
  if (emojiId && !resolved) {
    return <span className={`inline-block w-4 h-4 bg-muted/30 rounded ${className}`} />;
  }

  return <span className={`text-muted-foreground text-xs ${className}`}>[?]</span>;
};
