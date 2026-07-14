import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { Bold, Dice3, Eye, Italic, Link2, Palette, Strikethrough, Type, UnderlineIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { normalizeContent, prosemirrorToPlainText } from "@/utils/contentConverter";
import { SpoilerMark } from "@/components/emoji/SpoilerMark";
import { CustomTabExtension } from "@/components/CustomTabExtension";
import { EmojiDecorationExtension } from "@/components/emoji/EmojiDecorationPlugin";
import { useEmojiData } from "@/contexts/EmojiDataContext";

interface GomoRichEditorProps {
  contentJson?: unknown;
  legacyContent?: string | null;
  placeholder?: string;
  minHeightClassName?: string;
  resetKey?: string | number;
  onChange: (value: { json: unknown; text: string }) => void;
  onSubmit?: () => void;
}

export interface GomoRichEditorHandle {
  focus: () => void;
  insertText: (text: string) => void;
  insertEmoji: (data: { emojiId: string; packId: string; url: string; name: string }) => void;
}

const randomHexColor = () =>
  `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;

const normalizeHexColor = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const prefixed = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(prefixed) ? prefixed : null;
};

const Toolbar = ({ editor }: { editor: ReturnType<typeof useEditor> }) => {
  const [isColorDialogOpen, setIsColorDialogOpen] = useState(false);
  const [colorDraft, setColorDraft] = useState("#ff5500");
  const colorInputRef = useRef<HTMLInputElement>(null);

  if (!editor) return null;

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

  const toggleLink = () => {
    const url = window.prompt("Ссылка");
    if (url === null) return;
    const trimmedUrl = url.trim();
    if (trimmedUrl.length > 0) {
      editor.chain().focus().setLink({ href: trimmedUrl }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
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

  const openColorDialog = () => {
    setColorDraft(randomHexColor());
    setIsColorDialogOpen(true);
  };

  const setSize = () => {
    const size = window.prompt("Размер в px", "18");
    if (!size) return;
    const px = size.replace(/[^\d.]/g, "");
    editor.chain().focus().setMark('textStyle', { fontSize: `${px}px` }).run();
  };

  return (
    <>
      <div className="flex flex-nowrap gap-1 overflow-x-auto scrollbar-hide max-w-full border border-border/70 bg-background p-1">
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleTextFormat("bold")}><Bold className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleTextFormat("italic")}><Italic className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleTextFormat("underline")}><UnderlineIcon className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleTextFormat("strikethrough")}><Strikethrough className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={toggleLink}><Link2 className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={openColorDialog}><Palette className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={setSize}><Type className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0" onMouseDown={(e) => e.preventDefault()} onClick={toggleBlur}><Eye className="h-4 w-4" /></Button>
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
    </>
  );
};

export const GomoRichEditor = forwardRef<GomoRichEditorHandle, GomoRichEditorProps>(({
  contentJson,
  legacyContent,
  placeholder = "Напишите сообщение…",
  minHeightClassName = "min-h-[120px]",
  resetKey,
  onChange,
  onSubmit,
}, ref) => {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const composerKey = useMemo(() => String(resetKey ?? "stable"), [resetKey]);
  const { allEmojis } = useEmojiData();

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
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline" },
      }),
      TextStyle,
      Color,
      Placeholder.configure({ placeholder }),
      SpoilerMark,
      CustomTabExtension,
      EmojiDecorationExtension.configure({ emojiMap: allEmojis }),
    ],
    [placeholder, allEmojis]
  );

  const handleChange = useCallback(
    (editor: ReturnType<typeof useEditor> extends infer T ? T : never) => {
      if (!editor || !('getJSON' in editor)) return;
      const json = (editor as { getJSON: () => unknown }).getJSON();
      const text = (editor as { getText: () => string }).getText().trimEnd() || prosemirrorToPlainText(json, "");
      onChange({ json, text });
    },
    [onChange]
  );

  const editor = useEditor({
    extensions,
    content: initialContent || undefined,
    editorProps: {
      attributes: {
        class: `${minHeightClassName} relative z-10 outline-none bg-transparent text-sm sm:text-base`,
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: e }) => {
      handleChange(e);
    },
  });

  useEffect(() => {
    if (editor && initialContent) {
      editor.commands.setContent(initialContent);
    }
  }, [composerKey]);

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus(),
    insertText: (text: string) => {
      editor?.chain().focus().insertContent(text).run();
    },
    insertEmoji: (data: { emojiId: string; packId: string; url: string; name: string }) => {
      editor?.chain().focus().insertContent(`[e:${data.emojiId}]`).run();
    },
  }), [editor]);

  useEffect(() => {
    if (!editor) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey && window.innerWidth >= 768) {
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
    <div key={composerKey} className="space-y-2">
      <Toolbar editor={editor} />
      <div ref={editorContainerRef}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

GomoRichEditor.displayName = "GomoRichEditor";
