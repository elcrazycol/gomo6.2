import { Node, mergeAttributes, InputRule, nodePasteRule } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React from 'react';
import { useEmojiData } from '@/contexts/EmojiDataContext';
import { storageUrl } from '@/utils/storage';

// Input rules run against the text immediately before the caret and expect a
// single end-of-string match. Paste rules use String#matchAll internally and
// therefore require a separate global expression.
const EMOJI_INPUT_REGEX = /\[e:([a-f0-9-]{36})\]$/;
const EMOJI_PASTE_REGEX = /\[e:([a-f0-9-]{36})\]/g;

/**
 * Snap a click on the emoji to the nearest text boundary. The browser maps
 * clicks on a contenteditable=false inline element to an unpredictable
 * position, often flush against the emoji where typing does not work. This
 * uses ProseMirror coordinates so it is correct for every emoji in the
 * document, not just the first one. Returns true when handled.
 */
export const snapEmojiClick = (
  view: EditorView,
  nodePos: number,
  nodeSize: number,
  clientX: number
): boolean => {
  const node = view.state.doc.nodeAt(nodePos);
  if (!node || node.type.name !== 'customEmoji') return false;

  // An inline atom occupies a single document position: nodePos is the caret
  // position right before it, nodePos + nodeSize right after.
  const nodeStart = nodePos;
  const nodeEnd = nodePos + nodeSize;

  const before = view.coordsAtPos(nodeStart);
  const after = view.coordsAtPos(nodeEnd);

  let target: number;
  if (typeof before?.left === 'number' && typeof after?.right === 'number') {
    const midX = (before.left + after.right) / 2;
    target = clientX < midX ? nodeStart : nodeEnd;
  } else {
    // No reliable coordinates (e.g. detached/zero-size view): still place the
    // caret deterministically instead of deferring to the browser's broken
    // default mapping that puts it flush against the emoji.
    target = nodeStart;
  }
  const transaction = view.state.tr.setSelection(TextSelection.create(view.state.doc, target));
  view.dispatch(transaction);
  view.focus();
  return true;
};

const EmojiNodeView = ({ node }: { node: { attrs: Record<string, string | null> } }) => {
  const { allEmojis, resolveEmojis } = useEmojiData();
  const emojiId = node.attrs.emojiId;
  const fallback = node.attrs.fallback;

  const emoji = emojiId ? allEmojis.get(emojiId) : undefined;

  React.useEffect(() => {
    if (emojiId && !emoji) {
      resolveEmojis([emojiId]);
    }
  }, [emojiId, emoji, resolveEmojis]);

  if (emoji && emojiId) {
    const url = storageUrl('emojis', emoji.image_url);
    return (
      <NodeViewWrapper
        as="span"
        style={{ display: 'inline-block', verticalAlign: 'middle', lineHeight: 1, margin: '0 0.1em' }}
        contentEditable={false}
      >
        <span contentEditable={false}>
          <img
            src={url}
            alt={emoji.name}
            style={{ height: '1.2em', width: 'auto', verticalAlign: 'middle' }}
            draggable={false}
          />
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      style={{ display: 'inline-block', verticalAlign: 'middle', lineHeight: 1, margin: '0 0.1em' }}
      contentEditable={false}
      aria-label={fallback || 'Кастомный эмодзи'}
    >
      <span contentEditable={false}>
        {fallback || <span style={{ display: 'inline-block', width: '1.2em', height: '1.2em', background: 'rgba(128,128,128,0.2)', borderRadius: '2px', verticalAlign: 'middle' }} />}
      </span>
    </NodeViewWrapper>
  );
};

export interface CustomEmojiAttrs {
  emojiId: string | null;
  fallback?: string | null;
  // Kept optional for old documents; rendering always resolves by emojiId.
  url?: string | null;
  name?: string | null;
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
      fallback: { default: null },
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
            fallback: el.getAttribute('data-fallback'),
            name: img?.getAttribute('alt') ?? null,
          };
        },
      },
    ];
  },

  renderText({ node }) {
    return node.attrs.fallback || (node.attrs.emojiId ? `[e:${node.attrs.emojiId}]` : '�');
  },

  renderHTML({ HTMLAttributes }) {
    // The React NodeView is authoritative and resolves the image URL from
    // the trusted emoji record. Avoid serializing arbitrary src attributes.
    return [
      'span',
      mergeAttributes({
        'data-custom-emoji': '',
        'data-emoji-id': HTMLAttributes.emojiId,
        'data-fallback': HTMLAttributes.fallback || undefined,
        'aria-label': HTMLAttributes.fallback || HTMLAttributes.name || 'Кастомный эмодзи',
      }),
      HTMLAttributes.fallback || '�',
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmojiNodeView, {
      // ReactNodeViewRenderer creates an outer element around NodeViewWrapper.
      // Mark that element non-editable too; otherwise the browser can create a
      // DOM caret between/inside the wrapper even though the schema node is an
      // atom. The inner guard above covers browsers that retarget selection.
      attrs: {
        contenteditable: 'false',
      },
    });
  },

  // Telegram-like behavior: clicking a custom emoji must never turn it into a
  // NodeSelection with a surrounding highlight. Without this, ProseMirror
  // selects the whole inline atom on click, the NodeView gets the
  // ProseMirror-selectednode style and the caret looks like it is "inside"
  // the emoji even though it actually sits at the text boundary.
  selectable: false,

  addProseMirrorPlugins() {
    // Capture the node name now: `this` inside the click callback is the
    // ProseMirror EditorView, not the extension.
    const nodeName = this.name;

    return [
      new Plugin({
        props: {
          handleClickOn: (view: EditorView, _pos, node, nodePos, event) => {
            if (node.type.name !== nodeName) return false;
            return snapEmojiClick(view, nodePos, node.nodeSize, event.clientX);
          },
        },
      }),
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

  addInputRules() {
    return [
      new InputRule({
        find: EMOJI_INPUT_REGEX,
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
        find: EMOJI_PASTE_REGEX,
        type: this.type,
        getAttributes: (match) => ({
          emojiId: match[1],
        }),
      }),
    ];
  },
});
