import React, { useEffect } from "react";
import { useEmojiData } from "@/contexts/EmojiDataContext";
import { storageUrl } from "@/utils/storage";

interface NicknameEmojiProps {
  /** custom_emojis row id (users.nickname_emoji_id) */
  emojiId?: string | null;
  className?: string;
  title?: string;
}

/**
 * Renders the custom emoji a user chose for their nickname, resolving it by id
 * through the shared emoji data context (the same mechanism as inline custom
 * emojis in the editor). Renders nothing while unknown or after a failed
 * resolve, so nicknames degrade gracefully when an emoji is deleted.
 */
export const NicknameEmoji = ({ emojiId, className, title }: NicknameEmojiProps) => {
  const { allEmojis, resolveEmojis } = useEmojiData();
  const emoji = emojiId ? allEmojis.get(emojiId) : undefined;

  useEffect(() => {
    if (emojiId && !emoji) {
      resolveEmojis([emojiId]);
    }
  }, [emojiId, emoji, resolveEmojis]);

  if (!emojiId || !emoji) return null;

  return (
    <img
      src={storageUrl("emojis", emoji.image_url)}
      alt={emoji.name}
      title={title ?? emoji.name}
      className={`inline-block h-[1em] w-auto object-contain align-baseline select-none pointer-events-none shrink-0 ${className ?? ""}`}
      draggable={false}
    />
  );
};
