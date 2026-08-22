import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { Suggestion } from '@tiptap/suggestion';
import type { SuggestionKeyDownProps, SuggestionOptions } from '@tiptap/suggestion';
import { CustomEmojiSuggestions, type CustomEmojiSuggestionsHandle } from '@/components/emoji/CustomEmojiSuggestions';
import type { EmojiData } from '@/contexts/EmojiDataContext';
import { isEmojiSequence } from '@/utils/emojiGraphemes';

export const customEmojiPluginKey = new PluginKey('customEmojiSuggestion');

const emojiSequenceAtEnd = /(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)$/u;

/** Match the complete last Unicode emoji sequence immediately before the caret. */
const findEmojiMatch = ({ $position }: { $position: Editor['state']['selection']['$from'] }) => {
  const text = $position.nodeBefore?.isText ? $position.nodeBefore.text || '' : '';
  const match = text.match(emojiSequenceAtEnd);
  if (!match || match.index === undefined) return null;
  const query = match[0];
  return {
    range: { from: $position.pos - query.length, to: $position.pos },
    query,
    text: query,
  };
};

export const createCustomEmojiSuggestion = (getEmojis: () => EmojiData[]): Omit<SuggestionOptions<EmojiData, EmojiData>, 'editor'> => ({
  pluginKey: customEmojiPluginKey,
  char: '',
  allowedPrefixes: null,
  findSuggestionMatch: findEmojiMatch,
  allow: ({ range }) => range.from < range.to,
  items: ({ query }) => getEmojis().filter((emoji) => emoji.unicode_triggers?.some((trigger) => trigger === query && isEmojiSequence(trigger))).slice(0, 8),
  command: ({ editor, range, props }) => {
    editor.chain().focus(undefined, { scrollIntoView: false }).insertContentAt(range, [
      { type: 'customEmoji', attrs: { emojiId: props.id, fallback: props.unicode_triggers?.[0] || null, name: props.name } },
      { type: 'text', text: ' ' },
    ]).run();
  },
  render: () => {
    let component: ReactRenderer<CustomEmojiSuggestionsHandle, object> | null = null;
    let unmount: (() => void) | null = null;
    return {
      onStart: (props) => {
        component = new ReactRenderer(CustomEmojiSuggestions, { props, editor: props.editor, className: 'z-[9999]' });
        unmount = props.mount(component.element);
      },
      onUpdate: (props) => component?.updateProps(props),
      onKeyDown: (props: SuggestionKeyDownProps) => component?.ref?.onKeyDown(props) ?? false,
      onExit: () => {
        unmount?.();
        component?.destroy();
        component = null;
        unmount = null;
      },
    };
  },
});

export const createCustomEmojiSuggestionExtension = (getEmojis: () => EmojiData[]) => Extension.create({
  name: 'customEmojiSuggestion',
  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...createCustomEmojiSuggestion(getEmojis) })];
  },
});
