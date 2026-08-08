import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

// Inline style properties that clearly come from foreign documents (Word, web pages, mail).
// We deliberately KEEP `color` and `font-size`, because those are this app's own marks
// (TextStyle/Color) and must survive copy-paste between its own editors.
const FOREIGN_STYLE_PROPS = new Set([
  'font-family',
  'font-weight',
  'font-style',
  'background-color',
  'background',
  'line-height',
  'letter-spacing',
  'text-transform',
  'word-spacing',
  'text-indent',
  'white-space',
  'text-decoration',
  'float',
  'position',
  'vertical-align',
  'text-shadow',
  'box-shadow',
  'border',
  'border-radius',
  'padding',
  'margin',
  'width',
  'height',
  'display',
  'visibility',
]);

export const stripForeignStyles = (style: string): string => {
  const kept: string[] = [];
  for (const declaration of style.split(';')) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) continue;
    const prop = declaration.slice(0, colonIndex).trim().toLowerCase();
    if (!prop) continue;
    // Word/Outlook noise
    if (prop.startsWith('mso-') || prop.startsWith('-ms-') || prop.startsWith('-webkit-') || prop.startsWith('-moz-')) {
      continue;
    }
    if (FOREIGN_STYLE_PROPS.has(prop)) continue;
    kept.push(declaration.trim());
  }
  return kept.join('; ');
};

export const cleanPastedHtml = (html: string): string => {
  if (typeof DOMParser === 'undefined') return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Remove Word/Outlook XML junk before touching elements
    doc.querySelectorAll('o\\:p, xml, style, script, meta, title, head').forEach((node) => node.remove());

    doc.querySelectorAll('*').forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const tag = element.tagName.toLowerCase();

      if (tag === 'o:p' || tag === 'xml' || tag === 'font') {
        element.replaceWith(...Array.from(element.childNodes));
        return;
      }

      if (element.hasAttribute('style')) {
        const cleaned = stripForeignStyles(element.getAttribute('style') || '');
        if (cleaned) {
          element.setAttribute('style', cleaned);
        } else {
          element.removeAttribute('style');
        }
      }

      // Word class noise (MsoNormal, MsoHeader, …) — our own links render as <a>, not via class
      if (element.hasAttribute('class')) {
        const classes = (element.getAttribute('class') || '').split(/\s+/);
        if (classes.some((c) => /^mso/i.test(c))) {
          element.removeAttribute('class');
        }
      }

      // Empty span shells left after cleanup
      if (tag === 'span' && !element.hasAttribute('style') && !element.hasAttribute('data-hashtag') && !element.hasAttribute('data-spoiler') && element.childNodes.length === 0) {
        element.remove();
      }
    });

    return doc.body.innerHTML;
  } catch (error) {
    console.error('cleanPastedHtml failed', error);
    return html;
  }
};

/**
 * Strips foreign inline styles (Word, web pages, mail clients) when pasting into the editor,
 * while preserving the app's own color/font-size marks.
 */
export const PasteCleanup = Extension.create({
  name: 'pasteCleanup',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPastedHTML: (html) => cleanPastedHtml(html),
        },
      }),
    ];
  },
});
