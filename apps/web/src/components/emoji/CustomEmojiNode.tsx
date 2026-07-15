import { Node, mergeAttributes, InputRule, nodePasteRule } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React from 'react';
import { useEmojiData } from '@/contexts/EmojiDataContext';
import { storageUrl } from '@/utils/storage';

const EMOJI_ID_REGEX = /\[e:([a-f0-9-]{36})\]$/;

const EmojiNodeView = ({ node }: { node: { attrs: Record<string, string | null> } }) => {
  const { allEmojis, resolveEmojis } = useEmojiData();
  const emojiId = node.attrs.emojiId;

  const emoji = emojiId ? allEmojis.get(emojiId) : undefined;

  React.useEffect(() => {
    if (emojiId && !emoji) {
      resolveEmojis([emojiId]);
    }
  }, [emojiId, emoji, resolveEmojis]);

  if (emoji && emojiId) {
    const url = storageUrl('emojis', emoji.image_url);
    return (
      <NodeViewWrapper as="span" style={{ display: 'inline-block', verticalAlign: 'middle', lineHeight: 1, margin: '0 0.1em' }}>
        <img
          src={url}
          alt={emoji.name}
          style={{ height: '1.2em', width: 'auto', verticalAlign: 'middle', pointerEvents: 'none' }}
          draggable={false}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline-block', verticalAlign: 'middle', lineHeight: 1, margin: '0 0.1em' }}>
      <span style={{ display: 'inline-block', width: '1.2em', height: '1.2em', background: 'rgba(128,128,128,0.2)', borderRadius: '2px', verticalAlign: 'middle' }} />
    </NodeViewWrapper>
  );
};

export interface CustomEmojiAttrs {
  emojiId: string | null;
  url: string | null;
  name: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customEmoji: {
      setCustomEmoji: (attrs: CustomEmojiAttrs) => ReturnType;
    };
  }
}

export const CustomEmojiNode = Node.create({
  name: 'customEmoji',
  inline: true,
  atom: true,
  group: 'inline',

  addAttributes() {
    return {
      emojiId: { default: null },
      url: { default: null },
      name: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-custom-emoji]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          const img = el.querySelector('img');
          return {
            emojiId: el.getAttribute('data-emoji-id'),
            url: img?.getAttribute('src') ?? null,
            name: img?.getAttribute('alt') ?? null,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-custom-emoji': '',
        'data-emoji-id': HTMLAttributes.emojiId,
      }),
      [
        'img',
        {
          src: HTMLAttributes.url,
          alt: HTMLAttributes.name || 'emoji',
          style: 'height:1.2em;width:auto;vertical-align:middle',
        },
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmojiNodeView);
  },

  addCommands() {
    return {
      setCustomEmoji:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: EMOJI_ID_REGEX,
        handler: ({ state, range, match }) => {
          const emojiId = match[1];
          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({ emojiId }));
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      nodePasteRule({
        find: EMOJI_ID_REGEX,
        type: this.type,
        getAttributes: (match) => ({
          emojiId: match[1],
        }),
      }),
    ];
  },
});
