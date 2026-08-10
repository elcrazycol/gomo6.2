import { Node, mergeAttributes, InputRule, nodePasteRule, type NodeViewProps } from '@tiptap/core';
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

/**
 * Whether a click at clientX falls on the left half of the emoji box.
 * The caret is then placed before the emoji instead of after it.
 */
export const clickOnLeftHalf = (rect: { left: number; width: number }, clientX: number): boolean =>
  clientX < rect.left + rect.width / 2;

const EmojiNodeView = ({ node, editor, getPos }: NodeViewProps) => {
  const { allEmojis, resolveEmojis } = useEmojiData();
  const wrapperRef = React.useRef<HTMLElement | null>(null);
  const emojiId = node.attrs.emojiId;
  const fallback = node.attrs.fallback;

  const emoji = emojiId ? allEmojis.get(emojiId) : undefined;

  React.useEffect(() => {
    if (emojiId && !emoji) {
      resolveEmojis([emojiId]);
    }
  }, [emojiId, emoji, resolveEmojis]);

  // Clicking a non-editable inline element makes the browser place the caret
  // flush against it (or even create a selection), and ProseMirror's own click
  // handling cannot reliably correct that afterwards — typing then lands in a
  // position that does not work. Take over the pointer events at the DOM level,
  // before they bubble to the ProseMirror view, and place the caret
  // deterministically before/after the emoji depending on which half was hit.
  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const onMouseDown = (event: MouseEvent) => {
      // Only plain left clicks. Modified clicks (shift to extend, context menu,
      // etc.) keep their default browser/ProseMirror behavior.
      if (event.button !== 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;

      let pos: number;
      try {
        pos = getPos();
      } catch {
        return; // node view being torn down
      }

      event.preventDefault();
      event.stopPropagation();

      const rect = el.getBoundingClientRect();
      const target = clickOnLeftHalf(rect, event.clientX) ? pos : pos + node.nodeSize;
      editor.chain().focus().setTextSelection(target).run();
    };

    // The caret was already placed on mousedown. Swallow the click so
    // ProseMirror's click handling cannot override the selection again.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
    };

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('click', onClick);
    };
  }, [editor, getPos, node.nodeSize]);

  if (emoji && emojiId) {
    const url = storageUrl('emojis', emoji.image_url);
    // The wrapper must stay a leaf: no inner span with text, otherwise the
    // caret lands inside the node and cannot render. Baseline alignment
    // keeps the image inside the text line box.
    return (
      <NodeViewWrapper
        ref={wrapperRef}
        as="span"
        style={{ display: 'inline-block', verticalAlign: 'baseline', margin: '0 0.1em' }}
        contentEditable={false}
      >
        <img
          src={url}
          alt={emoji.name}
          style={{ height: '1em', width: 'auto', verticalAlign: 'baseline' }}
          draggable={false}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      as="span"
      style={{ display: 'inline-block', verticalAlign: 'baseline', margin: '0 0.1em' }}
      contentEditable={false}
      aria-label={fallback || 'Кастомный эмодзи'}
    >
      {fallback || <span style={{ display: 'inline-block', width: '1em', height: '1em', background: 'rgba(128,128,128,0.2)', borderRadius: '2px', verticalAlign: 'baseline' }} />}
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
