import { Node, mergeAttributes } from '@tiptap/core';

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
        contenteditable: 'false',
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
});
