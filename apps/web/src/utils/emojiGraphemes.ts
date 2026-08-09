const emojiSequence = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)$/u;

/** Split user-entered emoji into grapheme clusters without breaking ZWJ,
 * variation-selector, or skin-tone sequences. Intl.Segmenter is preferred;
 * the fallback keeps common emoji sequences intact in older browsers. */
export function splitEmojiGraphemes(value: string): string[] {
  const input = value.trim();
  if (!input) return [];

  const IntlWithSegmenter = Intl as typeof Intl & {
    Segmenter?: new (locales?: string[], options?: { granularity: 'grapheme' }) => {
      segment: (text: string) => Iterable<{ segment: string }>;
    };
  };
  if (IntlWithSegmenter.Segmenter) {
    return Array.from(new IntlWithSegmenter.Segmenter(undefined, { granularity: 'grapheme' }).segment(input), ({ segment }) => segment);
  }

  return Array.from(input.matchAll(/(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)|\r?\n|./gu), (match) => match[0]);
}

export function normalizeEmojiTriggers(value: string): string[] {
  return splitEmojiGraphemes(value)
    .filter((trigger) => emojiSequence.test(trigger) || /\p{Regional_Indicator}{2}/u.test(trigger))
    .slice(0, 3);
}

export function isEmojiSequence(value: string): boolean {
  return emojiSequence.test(value);
}
