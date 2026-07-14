import { useEffect, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $getTextContent, LexicalEditor } from 'lexical';
import { useEmojiData } from '@/contexts/EmojiDataContext';
import { storageUrl } from '@/utils/storage';

const EMOJI_REGEX = /\[e:([a-f0-9-]{36})\]/g;

function decorateEmojisInDOM(root: HTMLElement, emojiMap: Map<string, { image_url: string; name: string }>) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent && EMOJI_REGEX.test(node.textContent)) {
      textNodes.push(node);
    }
    EMOJI_REGEX.lastIndex = 0;
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent;
    if (!text) continue;

    EMOJI_REGEX.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = EMOJI_REGEX.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      const emojiId = match[1];
      const emoji = emojiMap.get(emojiId);

      const span = document.createElement('span');
      span.className = 'gomo-custom-emoji';
      span.contentEditable = 'false';
      span.dataset.emojiId = emojiId;

      const img = document.createElement('img');
      if (emoji) {
        img.src = storageUrl('emojis', emoji.image_url);
        img.alt = emoji.name;
      } else {
        img.src = '';
        img.alt = 'emoji';
      }
      img.style.height = '1.2em';
      img.style.width = 'auto';
      img.style.verticalAlign = 'middle';
      img.draggable = false;
      span.appendChild(img);

      fragment.appendChild(span);

      const zws = document.createTextNode('\u200B');
      fragment.appendChild(zws);

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    if (lastIndex > 0) {
      textNode.parentNode?.replaceChild(fragment, textNode);
    }
  }
}

export function EmojiDecorationPlugin() {
  const [editor] = useLexicalComposerContext();
  const { allEmojis, resolveEmojis } = useEmojiData();

  const getEmojiMap = useCallback(() => {
    return allEmojis;
  }, [allEmojis]);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const text = $getTextContent();
        const uuids = [...text.matchAll(/\[e:([a-f0-9-]{36})\]/g)].map(m => m[1]);
        const unresolved = uuids.filter(id => !allEmojis.has(id));
        if (unresolved.length > 0) {
          resolveEmojis(unresolved);
        }
      });

      const editorElement = editor.getRootElement();
      if (editorElement) {
        requestAnimationFrame(() => {
          decorateEmojisInDOM(editorElement, getEmojiMap());
        });
      }
    });
  }, [editor, allEmojis, resolveEmojis, getEmojiMap]);

  useEffect(() => {
    const editorElement = editor.getRootElement();
    if (editorElement) {
      decorateEmojisInDOM(editorElement, getEmojiMap());
    }
  }, [allEmojis, editor, getEmojiMap]);

  return null;
}
