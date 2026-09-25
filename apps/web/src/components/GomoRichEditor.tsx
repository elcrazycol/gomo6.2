import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { InkBar, InkButton } from "@/components/ui/ink-bar";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import type { Editor, Extensions } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Mention from "@tiptap/extension-mention";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { Bold, Dice3, Eye, Italic, Link2, Palette, Strikethrough, Type, UnderlineIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { isSlashPopupActive } from "@/components/editor/slash/slashCommands";

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
  /** Extra tiptap extensions appended to the default set (e.g. media nodes). */
  extraExtensions?: Extensions;
  /** Enable the ProseMirror dropcursor and hand dropped files to onFilesDropped. */
  enableMediaDrop?: boolean;
  /** Files dropped into the editor; `pos` is the drop position (null = unknown). */
  onFilesDropped?: (files: File[], pos: number | null) => void;
  /** Files pasted into the editor; `pos` is the paste position (null = unknown). */
  onFilesPasted?: (files: File[], pos: number | null) => void;
  onChange: (value: { json: unknown; text: string }) => void;
  onSubmit?: () => void;
}

export interface GomoRichEditorHandle {
  focus: () => void;
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

const ToolButton = ({
  active = false,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <InkButton
    size="sm"
    active={active}
    aria-pressed={active}
    title={title}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
  >
    {children}
  </InkButton>
);

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
    selector: ({ editor: e }) => {
      const charExtension = e.extensionManager.extensions.find((ext) => ext.name === "characterCount");
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        link: e.isActive("link"),
        spoiler: e.isActive("spoiler"),
        characters: (e.storage.characterCount as { characters?: () => number } | undefined)?.characters?.() ?? 0,
        limit: (charExtension?.options as { limit?: number | null } | undefined)?.limit ?? null,
      };
    },
  });

  const toggleTextFormat = (format: "bold" | "italic" | "underline" | "strikethrough") => {
    const chain = editor.chain().focus();
    switch (format) {
      case "bold": chain.toggleBold(); break;
      case "italic": chain.toggleItalic(); break;
      case "underline": chain.toggleUnderline(); break;
      case "strikethrough": chain.toggleStrike(); break;
    }
    chain.run();
  };

  const applyLink = () => {
    const trimmed = linkDraft.trim();
    if (trimmed.length === 0) {
      editor.chain().focus().unsetLink().run();
    } else {
      // Only treat explicit schemes as-is (https://, http://, mailto:, tel: …);
      // anything else gets https:// prepended ("localhost:3000/x" must not be
      // parsed as the "localhost" scheme).
      const hasScheme =
        /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^(mailto|tel|sms|ftp):/i.test(trimmed);
      const href = hasScheme ? trimmed : `https://${trimmed}`;
      editor.chain().focus().setLink({ href }).run();
    }
    setIsLinkDialogOpen(false);
  };

  const toggleBlur = () => {
    editor.chain().focus().toggleSpoiler().run();
  };

  const applyColor = (nextColor: string) => {
    if (!nextColor) {
      editor.chain().focus().unsetColor().run();
    } else {
      editor.chain().focus().setColor(nextColor).run();
    }
    setIsColorDialogOpen(false);
  };

  const handleApplyColor = () => {
    const normalized = normalizeHexColor(colorDraft);
    if (normalized === null) return;
    applyColor(normalized);
  };

  const applySize = (px?: number) => {
    const raw = px !== undefined ? String(px) : sizeDraft;
    const clean = raw.replace(/[^\d.]/g, "");
    if (clean) {
      editor.chain().focus().setMark("textStyle", { fontSize: `${clean}px` }).run();
    }
    setIsSizeDialogOpen(false);
  };

  // Floating glass capsule: centered, grouped, with a live character count and
  // an "ink" blob that springs under the hovered/focused button.
  return (
    <InkBar
        blobClassName="h-8 w-8"
        className={`sticky top-2 z-20 mx-auto flex w-fit max-w-full items-center gap-0.5 overflow-x-auto scrollbar-hide rounded-full border border-border/60 bg-background/70 p-1 shadow-lg shadow-black/5 backdrop-blur-md animate-in fade-in-0 slide-in-from-top-1 duration-300 motion-reduce:animate-none ${className}`}
      >
        <div className="flex items-center gap-0.5">
          <ToolButton active={active.bold} title="Жирный" onClick={() => toggleTextFormat("bold")}><Bold className="h-4 w-4" /></ToolButton>
          <ToolButton active={active.italic} title="Курсив" onClick={() => toggleTextFormat("italic")}><Italic className="h-4 w-4" /></ToolButton>
          <ToolButton active={active.underline} title="Подчёркнутый" onClick={() => toggleTextFormat("underline")}><UnderlineIcon className="h-4 w-4" /></ToolButton>
          <ToolButton active={active.strike} title="Зачёркнутый" onClick={() => toggleTextFormat("strikethrough")}><Strikethrough className="h-4 w-4" /></ToolButton>
        </div>
        <span className="mx-0.5 h-5 w-px shrink-0 bg-border/70" aria-hidden="true" />
        <div className="flex items-center gap-0.5">
          <Popover
            open={isLinkDialogOpen}
            onOpenChange={(open) => {
              if (open) setLinkDraft((editor.getAttributes("link") as { href?: string })?.href ?? "");
              setIsLinkDialogOpen(open);
            }}
          >
            <PopoverTrigger asChild>
              <InkButton size="sm" active={active.link} title="Ссылка" onMouseDown={(event) => event.preventDefault()}>
                <Link2 className="h-4 w-4" />
              </InkButton>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="center" className="w-72 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Ссылка</div>
              <Input
                autoFocus
                value={linkDraft}
                onChange={(event) => setLinkDraft(event.target.value)}
                placeholder="https://…"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyLink();
                  }
                }}
              />
              <p className="text-[11px] text-muted-foreground">Пусто — убрать ссылку.</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setIsLinkDialogOpen(false)}>Отмена</Button>
                <Button type="button" size="sm" onClick={applyLink}>Применить</Button>
              </div>
            </PopoverContent>
          </Popover>

          <Popover
            open={isColorDialogOpen}
            onOpenChange={(open) => {
              if (open) setColorDraft(randomHexColor());
              setIsColorDialogOpen(open);
            }}
          >
            <PopoverTrigger asChild>
              <InkButton size="sm" title="Цвет текста" onMouseDown={(event) => event.preventDefault()}>
                <Palette className="h-4 w-4" />
              </InkButton>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="center" className="w-72 space-y-3">
              <div className="text-xs font-medium text-muted-foreground">Цвет текста</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => colorInputRef.current?.click()}
                  className="h-9 w-9 shrink-0 rounded-md border border-border/70"
                  style={{ backgroundColor: normalizeHexColor(colorDraft) || "transparent" }}
                  title="Открыть палитру"
                  aria-label="Выбрать цвет"
                />
                <Input
                  value={colorDraft}
                  onChange={(event) => setColorDraft(event.target.value)}
                  placeholder={randomHexColor()}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 p-0"
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
              <div className="flex items-center justify-between gap-2">
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => applyColor("")}>
                  <X className="mr-1.5 h-3.5 w-3.5" /> Снять
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setIsColorDialogOpen(false)}>Отмена</Button>
                  <Button type="button" size="sm" onClick={handleApplyColor}>Применить</Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Popover
            open={isSizeDialogOpen}
            onOpenChange={(open) => {
              if (open) setSizeDraft("18");
              setIsSizeDialogOpen(open);
            }}
          >
            <PopoverTrigger asChild>
              <InkButton size="sm" title="Размер шрифта" onMouseDown={(event) => event.preventDefault()}>
                <Type className="h-4 w-4" />
              </InkButton>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="center" className="w-64 space-y-3">
              <div className="text-xs font-medium text-muted-foreground">Размер шрифта</div>
              <div className="flex flex-wrap gap-1.5">
                {[13, 16, 18, 20, 24].map((px) => (
                  <Button key={px} type="button" variant="outline" size="sm" onClick={() => applySize(px)}>{px}</Button>
                ))}
              </div>
              <Input
                value={sizeDraft}
                onChange={(event) => setSizeDraft(event.target.value)}
                placeholder="Размер в px"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setIsSizeDialogOpen(false)}>Отмена</Button>
                <Button type="button" size="sm" onClick={() => applySize()}>Применить</Button>
              </div>
            </PopoverContent>
          </Popover>

          <ToolButton active={active.spoiler} title="Спойлер (размытие)" onClick={toggleBlur}><Eye className="h-4 w-4" /></ToolButton>
        </div>
        <span className="mx-1 hidden shrink-0 px-1 font-mono text-[11px] tabular-nums text-muted-foreground sm:inline">
          {active.limit ? `${active.characters}/${active.limit}` : active.characters}
        </span>
      </InkBar>
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
  extraExtensions,
  enableMediaDrop = false,
  onFilesDropped,
  onFilesPasted,
  onChange,
  onSubmit,
}, ref) => {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const { customEmojiList } = useEmojiData();
  const customEmojiListRef = useRef(customEmojiList);
  customEmojiListRef.current = customEmojiList;
  // Keep the latest file handlers reachable from editorProps, which is only
  // read when the editor is created — a stale closure would break drop/paste.
  const onFilesDroppedRef = useRef(onFilesDropped);
  onFilesDroppedRef.current = onFilesDropped;
  const onFilesPastedRef = useRef(onFilesPasted);
  onFilesPastedRef.current = onFilesPasted;
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
        dropcursor: enableMediaDrop ? { color: "hsl(var(--primary))", width: 2 } : false,
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
      ...(extraExtensions ?? []),
    ],
    [placeholder, maxLength, enableMediaDrop, extraExtensions]
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
        class: `${minHeightClassName} ${maxHeightClassName ? `${maxHeightClassName} ` : ""}relative z-10 outline-none bg-transparent text-sm sm:text-base`,
        spellcheck: "true",
      },
      handleDrop: (view: EditorView, event: DragEvent) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0 || !onFilesDroppedRef.current) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
        onFilesDroppedRef.current(files, pos);
        return true;
      },
      handlePaste: (view: EditorView, event: ClipboardEvent) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0 || !onFilesPastedRef.current) return false;
        event.preventDefault();
        onFilesPastedRef.current(files, view.state.selection.from);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      handleChange(e);
    },
  });

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
          requestAnimationFrame(() => {
            if (window.scrollY !== scrollY || window.scrollX !== scrollX) {
              window.scrollTo({ top: scrollY, left: scrollX, behavior: 'instant' });
            }
          });
          return;
        }
      }
      editor.commands.focus("end");
    }
  }, [editor, autoFocus]);

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

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = editorContainerRef.current;
      if (!el) {
        editor?.commands.focus();
        return;
      }
      const editable = el.querySelector('[contenteditable]') as HTMLElement | null;
      if (!editable) {
        editor?.commands.focus();
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
    insertText: (text: string) => {
      editor?.chain().focus().insertContent(text).run();
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
        editor?.chain().focus().insertContent(node).run();
      }
    },
    getEditor: () => editor,
  }), [editor]);

  useEffect(() => {
    if (!editor) return;
    const el = editorContainerRef.current;
    if (!el) return;
    // The slash/mention popup clears its "active" flag when it consumes Enter,
    // and ProseMirror handles the keydown before this bubble listener runs — so
    // snapshot the popup state in the capture phase (which runs first) and use
    // it when deciding whether to submit. Without this, Enter with the slash
    // menu open published the post instead of selecting the item.
    let popupConsumesEnter = false;
    const captureKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        // Belt and suspenders: the module flag can go stale across an HMR
        // module instance, so also check that the slash popup is in the DOM.
        popupConsumesEnter =
          isSlashPopupActive() ||
          isMentionPopupActive() ||
          document.querySelector("[data-slash-item]") !== null;
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't submit while the @-mention/slash popup is open — Enter there
      // selects a user/item.
      if (event.key === "Enter" && !event.shiftKey && window.innerWidth >= 768 && !popupConsumesEnter) {
        event.preventDefault();
        onSubmit?.();
      }
    };
    el.addEventListener("keydown", captureKeyDown, true);
    el.addEventListener("keydown", handleKeyDown);
    return () => {
      el.removeEventListener("keydown", captureKeyDown, true);
      el.removeEventListener("keydown", handleKeyDown);
    };
  }, [editor, onSubmit]);

  // Cancel Safari scroll-to-reveal on tap. The global handleAppShellScroll in
  // mobileKeyboard.ts fires too late (after the scroll already happened and
  // caused a visible jank). Instead, arm a flag on mousedown/touchstart and
  // intercept the focus event: blur + refocus with preventScroll, capturing
  // scroll position and restoring it if Safari still scrolled.
  useEffect(() => {
    const el = editorContainerRef.current?.querySelector('[contenteditable]') as HTMLElement | null;
    if (!el) return;
    let tapPending = false;
    let scrollY = 0;
    let scrollX = 0;

    const onTap = () => {
      if (document.activeElement === el) return; // already focused
      tapPending = true;
      scrollY = window.scrollY;
      scrollX = window.scrollX;
    };

    const onFocus = (e: FocusEvent) => {
      if (!tapPending) return;
      tapPending = false;
      // The browser already applied focus and may have scrolled. Blur and
      // refocus with preventScroll, then restore scroll position if it changed.
      e.preventDefault();
      el.blur();
      el.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        if (window.scrollY !== scrollY || window.scrollX !== scrollX) {
          window.scrollTo({ top: scrollY, left: scrollX, behavior: 'instant' });
        }
      });
    };

    el.addEventListener('mousedown', onTap);
    el.addEventListener('touchstart', onTap);
    el.addEventListener('focus', onFocus);
    return () => {
      el.removeEventListener('mousedown', onTap);
      el.removeEventListener('touchstart', onTap);
      el.removeEventListener('focus', onFocus);
    };
  }, [editor]);

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
