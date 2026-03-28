import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onSubmit?: () => void;
}

export interface RichTextEditorHandle {
  focus: () => void;
  insertText: (text: string) => void;
  getSelectionStart: () => number;
  setSelectionStart: (pos: number) => void;
  getValue: () => string;
  getCursorRect: () => DOMRect | null;
  getElement: () => HTMLDivElement | null;
}

type EmojiIndex = Record<string, string>; // code -> image_url

const ZWS = "\u200B"; // zero-width space helper to keep caret usable around non-editable nodes

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE;
}

function extractPlainTextFromNode(root: HTMLElement): string {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const v = node.nodeValue ?? "";
      // ignore helper ZWS chars so they don't leak into stored value
      out.push(v.split(ZWS).join(""));
    } else if (isElement(node)) {
      if (node.tagName === "BR") out.push("\n");
      if (node.dataset && node.dataset.zws) {
        // ignore helper caret nodes
      }
      if (node.dataset && node.dataset.emojiOriginal) out.push(node.dataset.emojiOriginal);
    }
    node = walker.nextNode();
  }
  return out.join("");
}

function getCaretPlainOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);

  // More robust: take DOM fragment from start of editor to caret, then "serialize" it the same way as value.
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);

  const frag = pre.cloneContents();
  const tmp = document.createElement("div");
  tmp.appendChild(frag);
  return extractPlainTextFromNode(tmp).length;
}

function setCaretPlainOffset(root: HTMLElement, target: number) {
  const selection = window.getSelection();
  if (!selection) return;

  let remaining = Math.max(0, target);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.currentNode;

  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.nodeValue ?? "").split(ZWS).join("");
      if (remaining <= text.length) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      remaining -= text.length;
    } else if (isElement(node)) {
      if (node.dataset && node.dataset.zws) {
        // helper node; length 0
      } else
      if (node.dataset && node.dataset.emojiOriginal) {
        const len = node.dataset.emojiOriginal.length;
        if (remaining <= len) {
          // put caret after emoji object
          const range = document.createRange();
          range.setStartAfter(node);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
        remaining -= len;
      } else if (node.tagName === "BR") {
        if (remaining <= 1) {
          const range = document.createRange();
          range.setStartAfter(node);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
        remaining -= 1;
      }
    }
    node = walker.nextNode();
  }

  // fallback: end
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(({
  value,
  onChange,
  placeholder = "Напишите сообщение…",
  className = "",
  onSubmit
}: RichTextEditorProps, ref) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [emojiIndex, setEmojiIndex] = useState<EmojiIndex>({});
  const emojiIndexRef = useRef<EmojiIndex>({});

  useEffect(() => {
    emojiIndexRef.current = emojiIndex;
  }, [emojiIndex]);

  useEffect(() => {
    // load emoji index once (code -> image_url)
    const load = async () => {
      // NOTE: schema types may lag behind migrations in some environments; keep this runtime-safe.
      const { data, error } = await (supabase as any).from("emojis").select("code,image_url").limit(5000);
      if (error) return;
      const idx: EmojiIndex = {};
      for (const e of (data ?? []) as any[]) idx[e.code] = e.image_url;
      setEmojiIndex(idx);
    };
    load();
  }, []);

  const ensureEmojiLoaded = useCallback(async (code: string) => {
    if (!code) return;
    if (emojiIndexRef.current[code]) return;

    const { data, error } = await (supabase as any)
      .from("emojis")
      .select("code,image_url")
      .eq("code", code)
      .maybeSingle();

    if (error || !(data as any)?.image_url) return;

    setEmojiIndex((prev) => {
      if (prev[code]) return prev;
      return { ...prev, [code]: (data as any).image_url };
    });
  }, []);

  const textToHtml = useCallback((text: string) => {
    // Convert :code: into non-editable emoji objects, everything else stays plain (with <br>)
    const escaped = escapeHtml(text);
    const withBreaks = escaped.replace(/\n/g, "<br>");
    return withBreaks.replace(/:([^:\s]+):/g, (m, code) => {
      const url = emojiIndexRef.current[code];
      if (!url) return m;
      const original = `:${code}:`;
      // Add a zero-width-space after the non-editable span so caret & arrow keys work reliably.
      return `<span class="gomo-emoji" data-emoji-original="${original}" contenteditable="false"><img src="${url}" alt="${original}" title="${original}" /></span><span data-zws="1">${ZWS}</span>`;
    });
  }, []);

  const rerenderFromPlainText = useCallback((plain: string, caret?: number) => {
    const el = editorRef.current;
    if (!el) return;
    const nextHtml = textToHtml(plain);
    if (el.innerHTML !== nextHtml) {
      const pos = caret ?? getCaretPlainOffset(el);
      el.innerHTML = nextHtml;
      setCaretPlainOffset(el, pos);
    }
  }, [textToHtml]);

  // keep DOM in sync with external value (but preserve caret when possible)
  useEffect(() => {
    const el = editorRef.current;
    if (!el || isComposing) return;
    const current = extractPlainTextFromNode(el);
    if (current === value) return;
    const caret = getCaretPlainOffset(el);
    el.innerHTML = textToHtml(value);
    setCaretPlainOffset(el, caret);
  }, [value, textToHtml, isComposing]);

  // When emoji index updates (e.g., fetched lazily), re-render current text so :code: becomes <img>
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const plain = extractPlainTextFromNode(el);
    rerenderFromPlainText(plain);
  }, [emojiIndex, rerenderFromPlainText]);

  const emitChangeFromDom = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const text = extractPlainTextFromNode(el);
    onChange(text);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const el = editorRef.current;
    if (!el) return;

    if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 768) {
      e.preventDefault();
      onSubmit?.();
      return;
    }

    const deleteEmojiBeforeCaret = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!range.collapsed) return;

      const { startContainer, startOffset } = range;

      // Case 1: caret in text node at offset 0 -> previous element sibling could be emoji
      if (startContainer.nodeType === Node.TEXT_NODE) {
        const parent = startContainer.parentElement;
        const text = startContainer.nodeValue ?? "";

        // If caret is inside our ZWS helper, treat it as "after emoji"
        if (text.includes(ZWS) && startOffset > 0) {
          const prev = parent?.previousElementSibling;
          if (prev && prev.classList.contains("gomo-emoji")) {
            prev.remove();
            if (parent?.dataset?.zws) parent.remove();
            emitChangeFromDom();
            return true;
          }
        }
        if (startOffset === 0) {
          const prev = parent?.previousElementSibling;
          if (prev && prev.classList.contains("gomo-emoji")) {
            prev.remove();
            emitChangeFromDom();
            return true;
          }
        }
        return false;
      }

      // Case 2: caret in element node -> child just before offset could be emoji
      if (isElement(startContainer)) {
        const containerEl = startContainer as HTMLElement;
        const nodeBefore = containerEl.childNodes[startOffset - 1];
        if (nodeBefore && isElement(nodeBefore) && nodeBefore.classList.contains("gomo-emoji")) {
          nodeBefore.remove();
          emitChangeFromDom();
          return true;
        }
      }

      // Case 3: caret is inside editor element but previousSibling is emoji
      if (isElement(startContainer)) {
        const prev = (startContainer as HTMLElement).previousElementSibling;
        if (prev && prev.classList.contains("gomo-emoji")) {
          prev.remove();
          emitChangeFromDom();
          return true;
        }
      }

      return false;
    };

    // If caret is just after an emoji object and user presses Backspace, delete the whole object
    if (e.key === "Backspace") {
      // If we delete ourselves, prevent default backspace (so it doesn't eat extra chars)
      if (deleteEmojiBeforeCaret()) {
        e.preventDefault();
      }
    }
  }, [onSubmit, emitChangeFromDom]);

  const handleInput = useCallback(async () => {
    if (isComposing) return;
    const el = editorRef.current;
    if (!el) return;

    const caret = getCaretPlainOffset(el);
    const plain = extractPlainTextFromNode(el);

    // If user just completed :code: near caret, ensure it's loaded and re-render to replace immediately
    const before = plain.slice(0, caret);
    const m = before.match(/:([^:\s]+):$/);
    if (m?.[1]) {
      const code = m[1];
      await ensureEmojiLoaded(code);
    }

    rerenderFromPlainText(plain, caret);
    onChange(plain);
  }, [ensureEmojiLoaded, isComposing, onChange, rerenderFromPlainText]);

  const handleCompositionStart = useCallback(() => setIsComposing(true), []);
  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
    emitChangeFromDom();
  }, [emitChangeFromDom]);

  const insertText = useCallback((text: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const toInsert = /^:[^:\s]+:$/.test(text) ? `${text} ` : text;
    document.execCommand("insertText", false, toInsert);
    emitChangeFromDom();
  }, [emitChangeFromDom]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    insertText,
    getSelectionStart: () => editorRef.current ? getCaretPlainOffset(editorRef.current) : 0,
    setSelectionStart: (pos: number) => {
      if (!editorRef.current) return;
      setCaretPlainOffset(editorRef.current, pos);
    },
    getValue: () => {
      if (!editorRef.current) return "";
      return extractPlainTextFromNode(editorRef.current);
    },
    getCursorRect: () => {
      const el = editorRef.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.rangeCount === 0) return el?.getBoundingClientRect() ?? null;
      const r = sel.getRangeAt(0).cloneRange();
      // Insert a temp marker when range has 0 rects (common at line ends)
      const rect = r.getClientRects()[0] ?? r.getBoundingClientRect();
      if (rect && rect.width + rect.height > 0) return rect;
      return el.getBoundingClientRect();
    },
    getElement: () => editorRef.current
  }), [insertText]);

  return (
    <div
      ref={editorRef}
      contentEditable
      className={`min-h-[40px] max-h-[160px] overflow-y-auto p-3 border border-border/30 rounded-md bg-background/50 focus:outline-none focus:ring-2 focus:ring-primary/20 ${className}`}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      suppressContentEditableWarning={true}
      data-placeholder={value === '' ? placeholder : ''}
    />
  );
});

RichTextEditor.displayName = "RichTextEditor";