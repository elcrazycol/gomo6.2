import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Mention from "@tiptap/extension-mention";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { AtSign, Bold, Dice3, Eye, Italic, Link2, Palette, Strikethrough, Type, UnderlineIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EMPTY_EDITOR_STATE, normalizeContent, prosemirrorToPlainText } from "@/utils/contentConverter";
import { SpoilerMark } from "@/components/emoji/SpoilerMark";
import { HashtagMark } from "@/components/emoji/HashtagMark";
import { PasteCleanup } from "@/components/PasteCleanup";
import { CharacterCount } from "@tiptap/extension-character-count";
import { isMentionPopupActive, mentionSuggestion } from "@/components/editor/mentionSuggestions";
import { CustomTabExtension } from "@/components/CustomTabExtension";
import { CustomEmojiNode } from "@/components/emoji/CustomEmojiNode";
import { useEmojiData } from "@/contexts/EmojiDataContext";
import { createCustomEmojiSuggestionExtension } from "@/components/editor/customEmojiSuggestions";

interface GomoRichEditorProps {
  contentJson?: unknown;
  legacyContent?: string | null;
  placeholder?: string;
  minHeightClassName?: string;
  resetKey?: string | number;
  /** Maximum number of characters (plain text). Omit for no limit. */
  maxLength?: number;
  /** Cap the editing area's height (e.g. "max-h-[45vh] overflow-y-auto") so
      long text scrolls INSIDE the editor instead of growing the composer and
      fighting the mobile keyboard's scroll corrections. Omit for no cap. */
  maxHeightClassName?: string;
  /** Hide the formatting toolbar while a compact composer is idle. */
  showToolbar?: boolean;
  /** Extra class on the formatting toolbar row (e.g. entrance animation). */
  toolbarClassName?: string;
  /** Focus the editor as soon as it is ready. */
  autoFocus?: boolean;
  onChange: (value: { json: unknown; text: string }) => void;
  onSubmit?: () => void;
}

export interface GomoRichEditorHandle {
  focus: () => void;
  /** Move the caret to the end of the draft via a PURE selection dispatch —
      never a native focus (on iOS that re-triggers the focus-pan and resets
      the caret to the start). Safe to call when the editor is not focused. */
  moveCaretToEnd: () => void;
  insertText: (text: string) => void;
  insertEmoji: (
    data: { emojiId: string; packId: string; url: string; name: string },
    opts?: { focus?: boolean }
  ) => void;
  /** Live tiptap editor instance — lets parents render the formatting Toolbar
      outside the editor (e.g. a full-width panel above the input pill). */
  getEditor: () => Editor | null;
}

const randomHexColor = () =>
  `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;

const normalizeHexColor = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const prefixed = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(prefixed) ? prefixed : null;
};

export const Toolbar = ({ editor, className = "" }: { editor: Editor; className?: string }) => {
  const [isColorDialogOpen, setIsColorDialogOpen] = useState(false);
  const [colorDraft, setColorDraft] = useState("#ff5500");
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [isSizeDialogOpen, setIsSizeDialogOpen] = useState(false);
  const [sizeDraft, setSizeDraft] = useState("18");

  // Re-render the toolbar when the selection/marks change so toggle buttons
  // can show their active state (editor.isActive at the caret).
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      link: e.isActive("link"),
      spoiler: e.isActive("spoiler"),
    }),
  });

  const toolClass = (isActive: boolean) =>
    `h-8 w-8 p-0 flex-shrink-0${isActive ? " bg-primary/15 text-primary" : ""}`;

  const toggleTextFormat = (format: "bold" | "italic" | "underline" | "strikethrough") => {
    // scrollIntoView:false — the composer is pinned above the keyboard; a
    // Tiptap focus + scrollIntoView would pan the page (the "native" jump).
    const chain = editor.chain().focus(undefined, { scrollIntoView: false });
    switch (format) {
      case "bold": chain.toggleBold(); break;
      case "italic": chain.toggleItalic(); break;
      case "underline": chain.toggleUnderline(); break;
      case "strikethrough": chain.toggleStrike(); break;
    }
    chain.run();
  };

  const openLinkDialog = () => {
    const current = (editor.getAttributes("link") as { href?: string })?.href ?? "";
    setLinkDraft(current);
    setIsLinkDialogOpen(true);
  };

  const applyLink = () => {
    const trimmed = linkDraft.trim();
    if (trimmed.length === 0) {
      editor.chain().focus(undefined, { scrollIntoView: false }).unsetLink().run();
    } else {
      // Only treat explicit schemes as-is (https://, http://, mailto:, tel: …);
      // anything else gets https:// prepended ("localhost:3000/x" must not be
      // parsed as the "localhost" scheme).
      const hasScheme =
        /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^(mailto|tel|sms|ftp):/i.test(trimmed);
      const href = hasScheme ? trimmed : `https://${trimmed}`;
      editor.chain().focus(undefined, { scrollIntoView: false }).setLink({ href }).run();
    }
    setIsLinkDialogOpen(false);
  };

  const toggleBlur = () => {
    editor.chain().focus(undefined, { scrollIntoView: false }).toggleSpoiler().run();
  };

  // Insert "@" at the caret and let the suggestion plugin pick it up (it
  // re-runs findSuggestionMatch on every transaction). If the cursor sits
  // mid-word, a leading space is inserted first so the popup always opens.
  const insertMention = () => {
    const { from } = editor.state.selection;
    const charBefore = editor.state.doc.textBetween(Math.max(0, from - 1), from);
    const needsSpace = charBefore.length > 0 && !/\s/.test(charBefore);
    editor.chain().focus(undefined, { scrollIntoView: false }).insertContent(needsSpace ? " @" : "@").run();
  };

  const applyColor = (nextColor: string) => {
    if (!nextColor) {
      editor.chain().focus(undefined, { scrollIntoView: false }).unsetColor().run();
    } else {
      editor.chain().focus(undefined, { scrollIntoView: false }).setColor(nextColor).run();
    }
    setIsColorDialogOpen(false);
  };

  const handleApplyColor = () => {
    const normalized = normalizeHexColor(colorDraft);
    if (normalized === null) return;
    applyColor(normalized);
  };

  const openColorDialog = () => {
    setColorDraft(randomHexColor());
    setIsColorDialogOpen(true);
  };

  const openSizeDialog = () => {
    setSizeDraft("18");
    setIsSizeDialogOpen(true);
  };

  const applySize = (px?: number) => {
    const raw = px !== undefined ? String(px) : sizeDraft;
    const clean = raw.replace(/[^\d.]/g, "");
    if (clean) {
      editor.chain().focus(undefined, { scrollIntoView: false }).setMark("textStyle", { fontSize: `${clean}px` }).run();
    }
    setIsSizeDialogOpen(false);
  };

  return (
    <>
      <div className={`flex flex-nowrap gap-1 overflow-x-auto scrollbar-hide max-w-full border border-border/70 bg-background p-1 ${className}`}>
        <Button type="button" variant="ghost" size="sm" className={toolClass(active.bold)} aria-pressed={active.bold} title="Жирный" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleTextFormat("bold")}><Bold className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={toolClass(active.italic)} aria-pressed={active.italic} title="Курсив" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleTextFormat("italic")}><Italic className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={toolClass(active.underline)} aria-pressed={active.underline} title="Подчёркнутый" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleTextFormat("underline")}><UnderlineIcon className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={toolClass(active.strike)} aria-pressed={active.strike} title="Зачёркнутый" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleTextFormat("strikethrough")}><Strikethrough className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={toolClass(active.link)} aria-pressed={active.link} title="Ссылка" onMouseDown={(e) => e.preventDefault()} onClick={openLinkDialog}><Link2 className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={insertMention} title="Упомянуть пользователя"><AtSign className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={openColorDialog} title="Цвет текста"><Palette className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={openSizeDialog} title="Размер шрифта"><Type className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className={toolClass(active.spoiler)} aria-pressed={active.spoiler} title="Спойлер (размытие)" onMouseDown={(e) => e.preventDefault()} onClick={toggleBlur}><Eye className="h-4 w-4" /></Button>
      </div>

      <Dialog open={isColorDialogOpen} onOpenChange={setIsColorDialogOpen}>
        <DialogContent className="max-w-md border-border/70 bg-background">
          <DialogHeader>
            <DialogTitle>Цвет текста</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => colorInputRef.current?.click()}
                className="h-10 w-10 shrink-0 rounded-lg border border-border/70"
                style={{ backgroundColor: normalizeHexColor(colorDraft) || "transparent" }}
                title="Открыть палитру"
                aria-label="Выбрать цвет"
              />
              <Input
                value={colorDraft}
                onChange={(event) => setColorDraft(event.target.value)}
                placeholder={randomHexColor()}
                className="min-w-0 flex-[0_1_10rem]"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 p-0"
                onClick={() => setColorDraft(randomHexColor())}
                title="Случайный цвет"
              >
                <Dice3 className="h-4 w-4" />
              </Button>
            </div>

            <input
              ref={colorInputRef}
              type="color"
              value={normalizeHexColor(colorDraft) || "#ff5500"}
              onChange={(event) => setColorDraft(event.target.value)}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => applyColor("")}>
                <X className="mr-2 h-4 w-4" />
                Снять цвет
              </Button>
              <Button type="button" variant="outline" onClick={() => setIsColorDialogOpen(false)}>
                Отмена
              </Button>
            </div>
            <Button type="button" onClick={handleApplyColor}>
              Применить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
        <DialogContent className="max-w-md border-border/70 bg-background">
          <DialogHeader>
            <DialogTitle>Ссылка</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={linkDraft}
              onChange={(event) => setLinkDraft(event.target.value)}
              placeholder="https://…"
              onKeyDown={(event) => {
                if (event.key === "Enter") applyLink();
              }}
            />
            <p className="text-xs text-muted-foreground">
              Оставьте поле пустым, чтобы убрать ссылку.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:justify-end sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => setIsLinkDialogOpen(false)}>
              Отмена
            </Button>
            <Button type="button" onClick={applyLink}>
              Применить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSizeDialogOpen} onOpenChange={setIsSizeDialogOpen}>
        <DialogContent className="max-w-md border-border/70 bg-background">
          <DialogHeader>
            <DialogTitle>Размер шрифта</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {[13, 16, 18, 20, 24].map((px) => (
                <Button key={px} type="button" variant="outline" size="sm" onClick={() => applySize(px)}>
                  {px}px
                </Button>
              ))}
            </div>
            <Input
              value={sizeDraft}
              onChange={(event) => setSizeDraft(event.target.value)}
              placeholder="Размер в px"
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-end sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => setIsSizeDialogOpen(false)}>
              Отмена
            </Button>
            <Button type="button" onClick={() => applySize()}>
              Применить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const GomoRichEditor = forwardRef<GomoRichEditorHandle, GomoRichEditorProps>(({
  contentJson,
  legacyContent,
  placeholder = "Напишите сообщение…",
  minHeightClassName = "min-h-[120px]",
  maxHeightClassName,
  resetKey,
  maxLength,
  showToolbar = true,
  toolbarClassName,
  autoFocus = false,
  onChange,
  onSubmit,
}, ref) => {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const { customEmojiList } = useEmojiData();
  const customEmojiListRef = useRef(customEmojiList);
  customEmojiListRef.current = customEmojiList;
  const composerKey = useMemo(() => String(resetKey ?? "stable"), [resetKey]);
  // Start "handled" at the current key: useEditor already applies the initial
  // content at creation, so we only need to reset when resetKey changes.
  const lastResetKeyRef = useRef<string | null>(composerKey);

  const initialContent = useMemo(
    () => normalizeContent(contentJson, legacyContent),
    [contentJson, legacyContent]
  );

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        dropcursor: false,
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline" },
      }),
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: mentionSuggestion,
      }),
      TextStyle,
      Color,
      Placeholder.configure({ placeholder }),
      SpoilerMark,
      HashtagMark,
      PasteCleanup,
      CharacterCount.configure({
        limit: maxLength ?? null,
        mode: "textSize",
        // ProseMirror exposes custom atoms through textBetween as a leaf
        // separator. Count each custom emoji as one character, not its UUID.
        textCounter: (text) => Array.from(text).length,
      }),
      CustomTabExtension,
      CustomEmojiNode,
      createCustomEmojiSuggestionExtension(() => customEmojiListRef.current),
    ],
    [placeholder, maxLength]
  );

  const handleChange = useCallback(
    (editor: Editor) => {
      const json = editor.getJSON();
      const text = prosemirrorToPlainText(json, "") || editor.getText().trimEnd();
      onChange({ json, text });
    },
    [onChange]
  );

  const editor = useEditor({
    extensions,
    content: initialContent || undefined,
    editorProps: {
      attributes: {
        // touch-manipulation: no double-tap-zoom delay on the editable, so
        // iOS never pans the page trying to zoom when a tap lands in the
        // composer (the pan is what content jumps from).
        class: `${minHeightClassName} ${maxHeightClassName ? `${maxHeightClassName} ` : ""}relative z-10 touch-manipulation outline-none bg-transparent text-sm sm:text-base`,
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: e }) => {
      handleChange(e);
    },
  });

  // Tiptap calls view.dom.focus() WITHOUT preventScroll on iOS/Android
  // (verified in @tiptap/core's focus command — delayedFocus does a bare
  // view.dom.focus() there, plus a second view.focus() in a rAF). Every such
  // call re-triggers the native focus-pan AND resets the caret to the start of
  // the content, even when we already focused with preventScroll ourselves.
  // Patch the editor's DOM node so EVERY focus — ours, Tiptap's internal ones
  // (commands.focus(), the delayed focus after mount, toolbar chain().focus())
  // — is forced to preventScroll:true. (PM's own view.focus() is NOT patched:
  // it already goes through focusPreventScroll and additionally runs
  // selectionToDOM, which must keep working.) Restored on unmount.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const nativeFocus = dom.focus.bind(dom);
    dom.focus = (options?: FocusOptions) => {
      nativeFocus({ ...options, preventScroll: true });
    };
    return () => {
      dom.focus = nativeFocus;
    };
  }, [editor]);

  // Move the caret to the END of the draft. Two layers, because a single one
  // loses to iOS:
  //   1) ProseMirror state — a PURE selection dispatch, never
  //      editor.commands.focus("end") (on iOS that command calls
  //      view.dom.focus() WITHOUT preventScroll — the pan — and iOS then
  //      resets the caret to the START). Dispatching directly moves the caret
  //      with no native focus at all.
  //   2) Native DOM selection — iOS sometimes ignores PM's dispatch and keeps
  //      the DOM caret at the start of the contenteditable, so also collapse a
  //      real range at the last text node (or the root for an empty doc).
  const moveCaretToEnd = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    const { state, view } = editor;
    // atEnd resolves INSIDE the last textblock (doc.content.size counts the
    // paragraph node itself, so resolving there overshoots by one position).
    view.dispatch(state.tr.setSelection(TextSelection.atEnd(state.doc)));
    try {
      const domSel = window.getSelection?.();
      if (!domSel) return;
      const root = view.dom;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let last: Text | null = null;
      let n: Node | null;
      while ((n = walker.nextNode())) last = n as Text;
      const range = document.createRange();
      if (last && last.length >= 0) {
        range.setStart(last, last.length);
      } else {
        // Empty doc — collapse inside the editable itself.
        range.selectNodeContents(root);
      }
      range.collapse(false);
      domSel.removeAllRanges();
      domSel.addRange(range);
    } catch {
      // Best-effort — a caret nudge must never crash the composer.
    }
  }, [editor]);

  // iOS does NOT keep the caret where a selection dispatch puts it: while the
  // soft keyboard slides in, Safari re-syncs the DOM selection and resets the
  // caret to the START of the content, undoing the single dispatch we do right
  // after focus. So on autoFocus we re-assert the end-selection repeatedly
  // across the WHOLE keyboard-open window — immediately, in the next rAF,
  // at 50/150/350/600/850ms (the slide, the URL-bar collapse and any native
  // focus re-sync can each reset the caret), and again once fonts finish
  // loading (the custom font swap re-measures the caret against the final
  // metrics). All pan-free (pure dispatches + native ranges). Cancelled the
  // moment the user actually touches or types, so a deliberate caret placement
  // in the middle of the text is never overridden.
  const caretSettleTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const caretSettleRafRef = useRef<number | null>(null);
  const caretSettleCancelledRef = useRef(true);
  const clearCaretSettle = useCallback(() => {
    caretSettleCancelledRef.current = true;
    for (const timer of caretSettleTimersRef.current) clearTimeout(timer);
    caretSettleTimersRef.current.clear();
    if (caretSettleRafRef.current !== null) {
      cancelAnimationFrame(caretSettleRafRef.current);
      caretSettleRafRef.current = null;
    }
  }, []);
  const settleCaretToEnd = useCallback(() => {
    clearCaretSettle();
    caretSettleCancelledRef.current = false;
    const run = () => {
      // Cancelled by a user tap/typing (or unmount) mid-window — and only
      // nudge while the editor still owns focus (a blur must not yank the
      // caret around). Check the DOM directly (not editor.isFocused): on iOS
      // the ProseMirror focus event can lag the actual focus() call, and the
      // settle would skip every nudge waiting for a flag that arrives late.
      if (caretSettleCancelledRef.current || !editor || editor.isDestroyed) return;
      const dom = editor.view.dom;
      if (document.activeElement === dom || dom.contains(document.activeElement)) {
        moveCaretToEnd();
      }
    };
    run();
    caretSettleRafRef.current = requestAnimationFrame(run);
    for (const delay of [50, 150, 350, 600, 850]) {
      const timer = setTimeout(run, delay);
      caretSettleTimersRef.current.add(timer);
    }
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    if (fonts && typeof fonts.ready?.then === "function") {
      fonts.ready.then(run).catch(() => {});
    }
  }, [clearCaretSettle, editor, moveCaretToEnd]);

  useEffect(() => {
    if (editor && autoFocus) {
      const el = editorContainerRef.current;
      if (el) {
        const editable = el.querySelector('[contenteditable]') as HTMLElement | null;
        if (editable) {
          // Capture scroll position and restore if browser forces a scroll
          const scrollY = window.scrollY;
          const scrollX = window.scrollX;
          editable.focus({ preventScroll: true });
          // Focus FIRST (preventScroll — the only pan-free focus), then settle
          // the caret at the END of the draft via repeated pure selection
          // dispatches across the keyboard-open window (see settleCaretToEnd —
          // a single dispatch loses to iOS's own caret reset mid-animation).
          settleCaretToEnd();
          requestAnimationFrame(() => {
            if (window.scrollY !== scrollY || window.scrollX !== scrollX) {
              window.scrollTo({ top: scrollY, left: scrollX, behavior: 'instant' });
            }
          });
          return;
        }
      }
      // No contenteditable found (unlikely): focus the editor's own DOM node
      // with preventScroll — never the focus command, whose view.dom.focus()
      // on iOS pans.
      (editor.view.dom as HTMLElement | undefined)?.focus({ preventScroll: true });
      settleCaretToEnd();
    }
  }, [editor, autoFocus, settleCaretToEnd]);

  // Cancel pending caret-settle nudges when the user actually interacts (a
  // tap on the editable — which cleared the timers via the interception
  // below — or typing, which means the caret is exactly where they want it).
  // Only REAL content edits cancel: the settle's own caret nudges are
  // selection-only transactions, and clearing on those would kill the whole
  // re-dispatch chain after the first nudge — letting iOS's mid-animation
  // caret reset to the START win again. (@tiptap/core v3 already skips
  // non-docChanged transactions for the update event, but the guard keeps
  // the settle safe across versions.)
  const handleUserInput = useCallback(
    ({ transaction }: { editor: Editor; transaction: Transaction }) => {
      if (transaction.docChanged) clearCaretSettle();
    },
    [clearCaretSettle]
  );
  useEffect(() => {
    if (!editor) return;
    editor.on("update", handleUserInput);
    return () => {
      editor.off("update", handleUserInput);
      clearCaretSettle();
    };
  }, [editor, handleUserInput, clearCaretSettle]);

  // The app loads the user's Google Font with font-display: swap, so on the
  // VERY first open of a composer the custom font can still be downloading
  // while the editor is already focused. Chromium lays out the caret using
  // fallback-font metrics, and when the font swaps in the glyphs shift but the
  // caret keeps its stale rect — it reads as sitting in the middle of the
  // letters instead of after them. On the second open the font is cached, so
  // the problem vanishes. Fix: once document.fonts.ready resolves (or any font
  // batch finishes loading), re-apply the DOM selection at the current
  // position — a fresh range makes the browser recompute the caret rect
  // against the final font metrics. Harmless no-op when the caret is already
  // correct (or the editor isn't focused).
  useEffect(() => {
    if (!editor) return;
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    if (!fonts || typeof fonts.ready?.then !== "function") return;
    let cancelled = false;
    const realignCaret = () => {
      try {
        const view = editor.view;
        if (cancelled || editor.isDestroyed || !editor.isFocused || view.composing) return;
        const sel = view.state.selection;
        // Only the caret needs realigning. Skipping non-empty selections is
        // also what keeps a NodeSelection (e.g. a selected custom emoji atom)
        // from being collapsed by the re-applied range below.
        if (!sel.empty) return;
        // Force a synchronous reflow so the inline text is laid out with the
        // now-loaded font before the selection is re-applied — otherwise the
        // browser could still measure the caret against the stale layout.
        void view.dom.getBoundingClientRect();
        const pos = view.domAtPos(sel.from);
        if (!pos) return;
        // The editor lives in the top-level document (no shadow DOM), so
        // window.getSelection() is the right selection object.
        const domSel = window.getSelection?.();
        if (!domSel) return;
        const range = document.createRange();
        range.setStart(pos.node, pos.offset);
        range.collapse(true);
        domSel.removeAllRanges();
        domSel.addRange(range);
      } catch {
        // Realignment is best-effort — never let a font-load callback crash.
      }
    };
    fonts.ready.then(realignCaret).catch(() => {});
    // Also catch font batches that start loading after the editor mounted
    // (e.g. the user changes the font in Settings while a composer is open).
    fonts.addEventListener?.("loadingdone", realignCaret);
    return () => {
      cancelled = true;
      fonts.removeEventListener?.("loadingdone", realignCaret);
    };
  }, [editor]);

  // Reset the editor ONLY when the parent explicitly asks for it (resetKey changes).
  // The old code reset on every contentJson change — but parents echo the editor's own
  // output back via onChange, so this fired on every keystroke, calling setContent()
  // and yanking the cursor to the end of the text (and killing input after a spoiler).
  useEffect(() => {
    if (!editor || lastResetKeyRef.current === composerKey) return;
    lastResetKeyRef.current = composerKey;
    const nextContent = normalizeContent(contentJson, legacyContent);
    editor.commands.setContent(nextContent ?? EMPTY_EDITOR_STATE, { emitUpdate: false });
  }, [editor, composerKey, contentJson, legacyContent]);

  // ── Native-tap interception (the iOS keyboard-pan fix) ─────────────────────
  // A DIRECT tap on the contenteditable is a NATIVE focus — and on iOS the
  // native focus-scroll (the pan) is what makes the composer visibly fly down
  // then back up, even with the document pinned (the pinned guard can only
  // clamp window scroll AFTER the browser already shifted the visual viewport;
  // the pan itself is the jitter we see). Proof: opening the emoji panel first
  // and then switching to the keyboard is always smooth — that path focuses
  // the editor PROGRAMMATICALLY via editor.focus({preventScroll:true}).
  //
  // So: while the editor does NOT own focus, a tap-like touch on it is
  // intercepted and converted into the same programmatic focus — the native
  // focus (and its pan) never happens. The caret is placed at the tap point
  // via posAtCoords, so behavior is identical, just pan-free. Once focused,
  // taps are left alone (caret moves, text selection, inner scrolling all
  // work natively — and no pan can occur because focus doesn't change).
  // Non-tap gestures (scrolls, long-press selection, drag-select) are never
  // intercepted.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;

    let touchStart: { x: number; y: number; t: number } | null = null;
    let lastTapAt = 0;

    const focusAt = (x: number, y: number) => {
      const view = editor.view;
      try {
        const coords = view.posAtCoords({ left: x, top: y });
        if (coords) {
          // Set the caret at the tap point first — then focus without scroll;
          // ProseMirror syncs the DOM selection to the state on focus.
          view.dispatch(
            view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(coords.pos)))
          );
        }
      } catch {
        // posAtCoords needs document.elementFromPoint, which is missing in
        // some environments (jsdom). Fall through to a plain pan-free focus.
      }
      if (document.activeElement !== dom) {
        dom.focus({ preventScroll: true });
      }
    };

    // Atomic leaves (custom emoji, mention chips) are rendered
    // contenteditable="false" and handle their own taps (select/insert) —
    // intercepting would fight their click handlers.
    const onLeaf = (target: EventTarget | null) =>
      target instanceof Element && typeof target.closest === "function"
        ? target.closest('[contenteditable="false"]')
        : null;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches?.[0];
      if (!t) return;
      touchStart = { x: t.clientX, y: t.clientY, t: Date.now() };
    };

    const onTouchEnd = (e: TouchEvent) => {
      const start = touchStart;
      touchStart = null;
      const t = e.changedTouches?.[0];
      if (!start || !t || onLeaf(e.target)) return;
      // Only tap-like touches: short and still. Scrolls, long-press selection
      // and drag-selection keep their native behavior (and no pan can happen
      // on them — they don't change focus).
      const moved = Math.abs(t.clientX - start.x) + Math.abs(t.clientY - start.y);
      if (moved > 10 || Date.now() - start.t > 400) return;
      // Intercept EVERY tap, focused or not: a native tap on an already-focused
      // editor is still a native focus gesture on iOS (it re-runs the
      // scroll-to-caret pan), so converting it to a programmatic caret move is
      // what keeps the composer from jumping on the second and subsequent taps.
      const now = Date.now();
      // A quick second tap (double-tap word selection) is left alone — it is
      // an editing gesture the browser owns, and the editor is focused by then
      // so it cannot pan.
      if (now - lastTapAt < 300) {
        lastTapAt = now;
        return;
      }
      lastTapAt = now;
      // A deliberate caret placement: cancel any pending autoFocus caret
      // settle so it never yanks the caret back to the end.
      clearCaretSettle();
      e.preventDefault();
      focusAt(t.clientX, t.clientY);
    };

    dom.addEventListener("touchstart", onTouchStart, { passive: true });
    dom.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
    return () => {
      dom.removeEventListener("touchstart", onTouchStart);
      dom.removeEventListener("touchend", onTouchEnd, true);
    };
  }, [editor, clearCaretSettle]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = editorContainerRef.current;
      if (!el) {
        // No container: focus the editor's own DOM node with preventScroll —
        // never the focus command, whose view.dom.focus() on iOS pans.
        (editor?.view.dom as HTMLElement | undefined)?.focus({ preventScroll: true });
        return;
      }
      const editable = el.querySelector('[contenteditable]') as HTMLElement | null;
      if (!editable) {
        (editor?.view.dom as HTMLElement | undefined)?.focus({ preventScroll: true });
        return;
      }
      // Capture scroll position BEFORE focus. Mobile browsers often ignore
      // preventScroll:true and force-scroll to the focused element. We restore
      // the position immediately in the next frame if it changed.
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      editable.focus({ preventScroll: true });
      // If the browser still scrolled (it ignores preventScroll on mobile),
      // snap back instantly in the next frame.
      requestAnimationFrame(() => {
        if (window.scrollY !== scrollY || window.scrollX !== scrollX) {
          window.scrollTo({ top: scrollY, left: scrollX, behavior: 'instant' });
        }
      });
    },
    moveCaretToEnd,
    insertText: (text: string) => {
      editor?.chain().focus(undefined, { scrollIntoView: false }).insertContent(text).run();
    },
    insertEmoji: (data, opts) => {
      const node = {
        type: 'customEmoji',
        attrs: { emojiId: data.emojiId, fallback: null, name: data.name },
      };
      if (opts?.focus === false) {
        // Insert at the preserved selection WITHOUT refocusing — used while the
        // emoji panel replaces the soft keyboard (focus() would summon the
        // keyboard right back over the panel). ProseMirror keeps the caret in
        // its state, so the insert lands exactly where the user was typing.
        editor?.chain().insertContent(node).run();
      } else {
        editor?.chain().focus(undefined, { scrollIntoView: false }).insertContent(node).run();
      }
    },
    getEditor: () => editor,
  }), [editor, moveCaretToEnd]);

  useEffect(() => {
    if (!editor) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't submit while the @-mention popup is open — Enter there picks a user.
      if (event.key === "Enter" && !event.shiftKey && window.innerWidth >= 768 && !isMentionPopupActive()) {
        event.preventDefault();
        onSubmit?.();
      }
    };
    const el = editorContainerRef.current;
    if (!el) return;
    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [editor, onSubmit]);

  if (!editor) return null;

  return (
    <div className="space-y-2">
      {showToolbar && <Toolbar editor={editor} className={toolbarClassName} />}
      <div ref={editorContainerRef}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

GomoRichEditor.displayName = "GomoRichEditor";
