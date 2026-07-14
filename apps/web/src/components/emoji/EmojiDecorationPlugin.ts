import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Extension } from '@tiptap/core';
import { storageUrl } from '@/utils/storage';

export const EMOJI_REGEX = /\[e:([a-f0-9-]{36})\]/g;
const EMOJI_PLUGIN_KEY = new PluginKey('emojiDecorations');

function findEmojiRanges(doc: any): Array<{ from: number; to: number; emojiId: string }> {
  const ranges: Array<{ from: number; to: number; emojiId: string }> = [];

  doc.descendants((node: any, pos: number) => {
    if (node.isText) {
      const text = node.text || '';
      EMOJI_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = EMOJI_REGEX.exec(text)) !== null) {
        ranges.push({
          from: pos + match.index,
          to: pos + match.index + match[0].length,
          emojiId: match[1],
        });
      }
    }
  });

  return ranges;
}

function buildDecorations(
  doc: any,
  emojiMap: Map<string, { image_url: string; name: string }>,
): DecorationSet {
  const ranges = findEmojiRanges(doc);
  const decorations: Decoration[] = [];

  for (const { from, to, emojiId } of ranges) {
    const emoji = emojiMap.get(emojiId);
    const url = emoji ? storageUrl('emojis', emoji.image_url) : '';
    const alt = emoji?.name || 'emoji';

    const widget = document.createElement('span');
    widget.className = 'gomo-custom-emoji';
    widget.contentEditable = 'false';
    widget.dataset.emojiId = emojiId;

    const img = document.createElement('img');
    img.src = url;
    img.alt = alt;
    img.style.height = '1.2em';
    img.style.width = 'auto';
    img.style.verticalAlign = 'middle';
    img.draggable = false;
    widget.appendChild(img);

    decorations.push(Decoration.widget(from, widget, { side: -1 }));
  }

  return DecorationSet.create(doc, decorations);
}

export const EmojiDecorationExtension = Extension.create({
  name: 'emojiDecorations',

  addOptions() {
    return {
      emojiMap: new Map() as Map<string, { image_url: string; name: string }>,
    };
  },

  addProseMirrorPlugins() {
    const emojiMap = this.options.emojiMap;
    return [
      new Plugin({
        key: EMOJI_PLUGIN_KEY,
        state: {
          init: (_tr, state) => {
            return buildDecorations(state.doc, emojiMap);
          },
          apply: (tr, old, _oldState, newState) => {
            if (tr.docChanged) {
              return buildDecorations(newState.doc, emojiMap);
            }
            return old;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
