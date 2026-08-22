import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
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

  // AutoFocus: place the caret at the END BEFORE focusing, then focus once
  // with preventScroll, then re-assert ONCE in the next frame. When iOS
  // focuses a fresh contenteditable it snaps the caret to the current DOM
  // selection — so the selection must already be at the end before the focus
  // lands (PM syncs the DOM selection to its state on focus via selectionToDOM
  // on the patched view.focus). One rAF covers the keyboard slide-in reset;
  // no timer swarm — the caret is native from then on (the composer text uses
  // a system font, so there is no font-swap caret drift to chase either).
  useEffect(() => {
    if (!editor || !autoFocus) return;
    moveCaretToEnd();
    const el = editorContainerRef.current;
    const editable = el?.querySelector('[contenteditable]') as HTMLElement | null;
    if (editable) {
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      editable.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        // Snap back if the browser scrolled anyway (mobile browsers can
        // ignore preventScroll), and re-assert the end caret once — the
        // keyboard slide-in can still reset it right after focus.
        if (window.scrollY !== scrollY || window.scrollX !== scrollX) {
          window.scrollTo({ top: scrollY, left: scrollX, behavior: "instant" });
        }
        if (document.activeElement === editable || editable.contains(document.activeElement)) {
          moveCaretToEnd();
        }
      });
      return;
    }
    // No contenteditable found (unlikely): focus the editor's own DOM node
    // with preventScroll — never the focus command, whose view.dom.focus()
    // on iOS pans.
    (editor.view.dom as HTMLElement | undefined)?.focus({ preventScroll: true });
  }, [editor, autoFocus, moveCaretToEnd]);

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
