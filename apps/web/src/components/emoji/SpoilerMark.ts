import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    spoiler: {
      toggleSpoiler: () => ReturnType;
    };
  }
}

export const SpoilerMark = Mark.create({
  name: 'spoiler',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-spoiler]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          const style = el.getAttribute('style') || '';
          return {
            revealed: style.includes('blur(0px)') || el.getAttribute('data-spoiler-revealed') === 'true',
          };
        },
      },
      {
        style: 'filter',
        getAttrs: (value) => {
          if (typeof value === 'string' && value.includes('blur')) {
            return {};
          }
          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const revealed = HTMLAttributes.revealed === true || HTMLAttributes.revealed === 'true';
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-spoiler': '',
        'data-spoiler-revealed': revealed ? 'true' : undefined,
        contenteditable: 'false',
        style: revealed
          ? 'filter:blur(0px);-webkit-filter:blur(0px);background-color:hsl(var(--muted)/0.45);border:1px solid hsl(var(--border)/0.8);border-radius:0.45rem;padding:0.08rem 0.35rem;cursor:pointer;transition:filter 180ms ease'
          : 'filter:blur(6px);-webkit-filter:blur(6px);background-color:hsl(var(--muted)/0.7);border:1px solid hsl(var(--border)/0.8);border-radius:0.45rem;padding:0.08rem 0.35rem;cursor:pointer;transition:filter 180ms ease',
      }),
    ];
  },

  addCommands() {
    return {
      toggleSpoiler:
        () =>
        ({ commands }) => {
          return commands.toggleMark(this.name);
        },
    };
  },
});
