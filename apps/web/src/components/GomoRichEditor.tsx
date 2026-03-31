import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { FORMAT_TEXT_COMMAND, $getRoot, $getSelection, $isRangeSelection } from "lexical";
import { TOGGLE_LINK_COMMAND, LinkNode } from "@lexical/link";
import { $patchStyleText } from "@lexical/selection";
import { Bold, Eye, Italic, Link2, Palette, Strikethrough, Type, Underline, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizeLexicalContent, lexicalJsonToPlainText, insertTextAtSelection } from "@/utils/lexicalContent";

interface GomoRichEditorProps {
  contentJson?: unknown;
  legacyContent?: string | null;
  placeholder?: string;
  minHeightClassName?: string;
  onChange: (value: { json: unknown; text: string }) => void;
  onSubmit?: () => void;
}

export interface GomoRichEditorHandle {
  focus: () => void;
  insertText: (text: string) => void;
}

const theme = {
  paragraph: "mb-0",
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
  },
  link: "text-primary underline",
};

const Toolbar = () => {
  const [editor] = useLexicalComposerContext();

  const toggleTextFormat = (format: "bold" | "italic" | "underline" | "strikethrough") => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  };

  const patchStyle = (style: Record<string, string>) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, style);
      }
    });
  };

  const toggleLink = () => {
    const url = window.prompt("Ссылка");
    if (!url) return;
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
  };

  const setColor = () => {
    const color = window.prompt("Цвет, например #ff5500", "#ff5500");
    if (!color) return;
    patchStyle({ color });
  };

  const setSize = () => {
    const size = window.prompt("Размер в px", "18");
    if (!size) return;
    patchStyle({ fontSize: `${size.replace(/[^\d.]/g, "")}px` });
  };

  const setSpoiler = () => patchStyle({ "--gomo-spoiler": "1" } as Record<string, string>);
  const setBlur = () => patchStyle({ "--gomo-blur": "1" } as Record<string, string>);

  return (
    <div className="flex flex-wrap gap-1 border border-border/70 bg-background p-1">
      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleTextFormat("bold")}><Bold className="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleTextFormat("italic")}><Italic className="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleTextFormat("underline")}><Underline className="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggleTextFormat("strikethrough")}><Strikethrough className="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={toggleLink}><Link2 className="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={setColor}><Palette className="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={setSize}><Type className="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={setBlur}><Eye className="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={setSpoiler}><Zap className="h-4 w-4" /></Button>
    </div>
  );
};

const EditorBridge = forwardRef<GomoRichEditorHandle>((_, ref) => {
  const [editor] = useLexicalComposerContext();

  useImperativeHandle(ref, () => ({
    focus: () => editor.focus(),
    insertText: (text: string) => insertTextAtSelection(editor as any, text),
  }), [editor]);

  return null;
});

EditorBridge.displayName = "EditorBridge";

export const GomoRichEditor = forwardRef<GomoRichEditorHandle, GomoRichEditorProps>(({
  contentJson,
  legacyContent,
  placeholder = "Напишите сообщение…",
  minHeightClassName = "min-h-[120px]",
  onChange,
  onSubmit,
}, ref) => {
  const bridgeRef = useRef<GomoRichEditorHandle>(null);
  const initialState = useMemo(() => normalizeLexicalContent(contentJson, legacyContent), [contentJson, legacyContent]);
  const composerKey = useMemo(() => JSON.stringify(initialState), [initialState]);

  useImperativeHandle(ref, () => ({
    focus: () => bridgeRef.current?.focus(),
    insertText: (text: string) => bridgeRef.current?.insertText(text),
  }), []);

  return (
    <LexicalComposer
      key={composerKey}
      initialConfig={{
        namespace: "gomo-rich-editor",
        theme,
        onError(error) {
          throw error;
        },
        nodes: [LinkNode],
        editorState: JSON.stringify(initialState),
      }}
    >
      <div className="space-y-2">
        <Toolbar />
        <div
          className="relative border border-border/70 bg-background p-3"
          onKeyDownCapture={(event) => {
            if (event.key === "Enter" && !event.shiftKey && window.innerWidth >= 768) {
              event.preventDefault();
              onSubmit?.();
            }
          }}
        >
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className={`${minHeightClassName} outline-none text-sm sm:text-base`}
                spellCheck
              />
            }
            placeholder={<div className="pointer-events-none absolute text-muted-foreground">{placeholder}</div>}
            ErrorBoundary={() => null}
          />
          <HistoryPlugin />
          <LinkPlugin />
          <OnChangePlugin
            onChange={(editorState) => {
              const json = editorState.toJSON();
              editorState.read(() => {
                const text = $getRoot().getTextContent();
                onChange({ json, text: text.trimEnd() || lexicalJsonToPlainText(json, "") });
              });
            }}
          />
          <EditorBridge ref={bridgeRef} />
        </div>
      </div>
    </LexicalComposer>
  );
});

GomoRichEditor.displayName = "GomoRichEditor";
