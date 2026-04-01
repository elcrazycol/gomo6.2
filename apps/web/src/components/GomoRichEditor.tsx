import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_LOW, FORMAT_TEXT_COMMAND, KEY_DOWN_COMMAND, $createParagraphNode, $createTextNode, $getNodeByKey, $getRoot, $getSelection, $isRangeSelection, $isTextNode } from "lexical";
import { TOGGLE_LINK_COMMAND, LinkNode } from "@lexical/link";
import { $getSelectionStyleValueForProperty, $patchStyleText } from "@lexical/selection";
import { mergeRegister } from "@lexical/utils";
import { Bold, Dice3, Eye, Italic, Link2, Palette, Strikethrough, Type, Underline, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { normalizeLexicalContent, lexicalJsonToPlainText, insertTextAtSelection, EMPTY_EDITOR_STATE } from "@/utils/lexicalContent";

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

const revealBlurNode = (node: HTMLElement) => {
  node.style.filter = "blur(0px)";
  node.style.webkitFilter = "blur(0px)";
  node.style.backgroundColor = "hsl(var(--muted) / 0.45)";
  node.style.border = "1px solid hsl(var(--border) / 0.8)";
  node.style.borderRadius = "0.45rem";
  node.style.padding = "0.08rem 0.35rem";
  node.dataset.gomoBlurEditing = "true";
};

const concealBlurNode = (node: HTMLElement) => {
  node.style.filter = node.dataset.gomoBlurFilter || "blur(6px)";
  node.style.webkitFilter = node.dataset.gomoBlurWebkitFilter || "blur(6px)";
  node.style.backgroundColor = "hsl(var(--muted) / 0.7)";
  node.style.border = "1px solid hsl(var(--border) / 0.8)";
  node.style.borderRadius = "0.45rem";
  node.style.padding = "0.08rem 0.35rem";
  delete node.dataset.gomoBlurEditing;
};

const syncActiveBlurNode = (container: HTMLElement | null) => {
  if (!container) return;

  const blurNodes = Array.from(container.querySelectorAll("span[style*='--gomo-blur']")) as HTMLElement[];
  if (blurNodes.length === 0) return;

  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode ?? null;
  const anchorElement =
    anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement ?? null;
  const activeBlurNode = anchorElement?.closest("span[style*='--gomo-blur']") as HTMLElement | null;

  blurNodes.forEach((node) => {
    node.dataset.gomoBlurFilter = node.dataset.gomoBlurFilter || node.style.filter || "blur(6px)";
    node.dataset.gomoBlurWebkitFilter = node.dataset.gomoBlurWebkitFilter || node.style.webkitFilter || "blur(6px)";

    if (activeBlurNode === node) {
      revealBlurNode(node);
    } else if (node.dataset.gomoBlurEditing === "true") {
      concealBlurNode(node);
    }
  });
};

const concealAllBlurNodes = (container: HTMLElement | null) => {
  if (!container) return;

  const blurNodes = Array.from(container.querySelectorAll("span[style*='--gomo-blur']")) as HTMLElement[];
  blurNodes.forEach((node) => concealBlurNode(node));
};

interface RangeSelectionSnapshot {
  anchorKey: string;
  anchorOffset: number;
  focusKey: string;
  focusOffset: number;
  text: string;
  color: string;
}

const randomHexColor = () =>
  `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;

const normalizeHexColor = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const prefixed = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(prefixed) ? prefixed : null;
};

const StyleContinuationPlugin = () => {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          if (event.metaKey || event.ctrlKey || event.altKey) {
            return false;
          }

          let handled = false;

          editor.update(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
              return;
            }

            const hasActiveInlineContinuation = Boolean(selection.style) || selection.format !== 0;
            if (!hasActiveInlineContinuation) {
              return;
            }

            if (event.key === "Enter") {
              selection.setStyle("");
              selection.setFormat(0);
              handled = false;
              return;
            }

            if (event.key !== " ") {
              return;
            }

            const anchorNode = selection.anchor.getNode();
            if (!$isTextNode(anchorNode)) {
              return;
            }

            const text = anchorNode.getTextContent();
            const previousChar = text[Math.max(0, selection.anchor.offset - 1)] ?? "";

            if (previousChar === " " || previousChar === "\n") {
              selection.setStyle("");
              selection.setFormat(0);
            }
          });

          return handled;
        },
        COMMAND_PRIORITY_LOW
      )
    );
  }, [editor]);

  return null;
};

const InitialContentPlugin = ({
  initialState,
}: {
  initialState: unknown;
}) => {
  const [editor] = useLexicalComposerContext();
  const initializedRef = useRef(false);

  React.useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    try {
      const parsedState = editor.parseEditorState(JSON.stringify(initialState));
      editor.setEditorState(parsedState);
    } catch (error) {
      console.error("Failed to initialize Lexical editor state, falling back to empty paragraph", error);
      try {
        const fallbackState = editor.parseEditorState(JSON.stringify(EMPTY_EDITOR_STATE));
        editor.setEditorState(fallbackState);
      } catch {
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode(""));
          root.append(paragraph);
        });
      }
    }
  }, [editor, initialState]);

  return null;
};

const Toolbar = () => {
  const [editor] = useLexicalComposerContext();
  const [isColorDialogOpen, setIsColorDialogOpen] = useState(false);
  const [colorDraft, setColorDraft] = useState("#ff5500");
  const [selectionSnapshot, setSelectionSnapshot] = useState<RangeSelectionSnapshot | null>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const keepSelection = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

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

  const withSavedSelection = (callback: (selection: ReturnType<typeof $getSelection>) => void) => {
    editor.update(() => {
      let selection = $getSelection();

      if ((!$isRangeSelection(selection) || !selection) && selectionSnapshot) {
        const anchorNode = $getNodeByKey(selectionSnapshot.anchorKey);
        const focusNode = $getNodeByKey(selectionSnapshot.focusKey);

        if ($isTextNode(anchorNode) && $isTextNode(focusNode)) {
          const rootSelection = $getSelection();
          if ($isRangeSelection(rootSelection)) {
            rootSelection.setTextNodeRange(
              anchorNode,
              selectionSnapshot.anchorOffset,
              focusNode,
              selectionSnapshot.focusOffset
            );
            selection = rootSelection;
          }
        }
      }

      if ($isRangeSelection(selection)) {
        callback(selection);
      }
    });
  };

  const toggleStyle = (styleProperty: string, onStyles: Record<string, string>, offStyles: Record<string, string>) => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      if (selection.isCollapsed()) return;

      const currentStyle = selection.style || "";
      const currentValue = styleProperty === "--gomo-blur"
        ? currentStyle.includes("--gomo-blur") || /(^|;)\s*(?:-webkit-)?filter\s*:\s*blur\(/i.test(currentStyle)
        : Boolean($getSelectionStyleValueForProperty(selection, styleProperty, ""));

      $patchStyleText(selection, currentValue ? offStyles : onStyles);

      selection.setStyle("");
    });
  };

  const toggleLink = () => {
    const url = window.prompt("Ссылка");
    if (url === null) return;

    const trimmedUrl = url.trim();
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, trimmedUrl.length > 0 ? trimmedUrl : null);
  };

  const openColorDialog = () => {
    let nextSnapshot: RangeSelectionSnapshot | null = null;

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) {
        return;
      }

      const anchorNode = selection.anchor.getNode();
      const focusNode = selection.focus.getNode();

      nextSnapshot = {
        anchorKey: anchorNode.getKey(),
        anchorOffset: selection.anchor.offset,
        focusKey: focusNode.getKey(),
        focusOffset: selection.focus.offset,
        text: selection.getTextContent(),
        color: $getSelectionStyleValueForProperty(selection, "color", "") || "",
      };
    });

    if (!nextSnapshot) {
      return;
    }

    setSelectionSnapshot(nextSnapshot);
    setColorDraft(nextSnapshot.color || "#ff5500");
    setIsColorDialogOpen(true);
  };

  const applyColor = (nextColor: string) => {
    withSavedSelection((selection) => {
      $patchStyleText(selection, { color: nextColor });
      if (!nextColor) {
        selection.setStyle("");
      }
    });
    setIsColorDialogOpen(false);
  };

  const handleApplyColor = () => {
    const normalized = normalizeHexColor(colorDraft);
    if (normalized === null) return;
    applyColor(normalized);
  };

  const setSize = () => {
    const size = window.prompt("Размер в px", "18");
    if (!size) return;
    patchStyle({ fontSize: `${size.replace(/[^\d.]/g, "")}px` });
  };

  const setBlur = () => toggleStyle(
    "--gomo-blur",
    {
      "--gomo-blur": "1",
      filter: "blur(6px)",
      WebkitFilter: "blur(6px)",
      transition: "filter 180ms ease",
      cursor: "pointer",
      backgroundColor: "hsl(var(--muted) / 0.7)",
      border: "1px solid hsl(var(--border) / 0.8)",
      borderRadius: "0.45rem",
      padding: "0.08rem 0.35rem",
    } as Record<string, string>,
    {
      "--gomo-blur": "",
      filter: "",
      WebkitFilter: "",
      transition: "",
      cursor: "",
      backgroundColor: "",
      border: "",
      borderRadius: "",
      padding: "",
    } as Record<string, string>
  );

  return (
    <>
      <div className="flex flex-wrap gap-1 border border-border/70 bg-background p-1">
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onMouseDown={keepSelection} onClick={() => toggleTextFormat("bold")}><Bold className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onMouseDown={keepSelection} onClick={() => toggleTextFormat("italic")}><Italic className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onMouseDown={keepSelection} onClick={() => toggleTextFormat("underline")}><Underline className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onMouseDown={keepSelection} onClick={() => toggleTextFormat("strikethrough")}><Strikethrough className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onMouseDown={keepSelection} onClick={toggleLink}><Link2 className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onMouseDown={keepSelection} onClick={openColorDialog}><Palette className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onMouseDown={keepSelection} onClick={setSize}><Type className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onMouseDown={keepSelection} onClick={setBlur}><Eye className="h-4 w-4" /></Button>
      </div>

      <Dialog open={isColorDialogOpen} onOpenChange={setIsColorDialogOpen}>
        <DialogContent className="max-w-md border-border/70 bg-background">
          <DialogHeader>
            <DialogTitle>Цвет текста</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Выделенный текст
              </div>
              <div
                className="min-h-12 break-words text-base leading-7"
                style={{ color: normalizeHexColor(colorDraft) || undefined }}
              >
                {selectionSnapshot?.text || "Нет выделенного текста"}
              </div>
            </div>

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
                placeholder="#ff5500"
                className="flex-1 min-w-0"
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
  resetKey,
  onChange,
  onSubmit,
}, ref) => {
  const bridgeRef = useRef<GomoRichEditorHandle>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const initialState = useMemo(
    () => normalizeLexicalContent(contentJson, legacyContent),
    [resetKey]
  );
  const composerKey = useMemo(() => String(resetKey ?? "stable"), [resetKey]);

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
      }}
    >
      <div className="space-y-2">
        <Toolbar />
        <div
          ref={editorContainerRef}
          className="relative border border-border/70 bg-background p-3"
          onKeyDownCapture={(event) => {
            if (event.key === "Enter" && !event.shiftKey && window.innerWidth >= 768) {
              event.preventDefault();
              onSubmit?.();
            }
          }}
          onKeyUpCapture={() => {
            syncActiveBlurNode(editorContainerRef.current);
          }}
          onMouseUpCapture={() => {
            syncActiveBlurNode(editorContainerRef.current);
          }}
          onFocusCapture={() => {
            syncActiveBlurNode(editorContainerRef.current);
          }}
          onBlurCapture={() => {
            window.setTimeout(() => {
              concealAllBlurNodes(editorContainerRef.current);
            }, 0);
          }}
          onClickCapture={(event) => {
            const target = event.target as HTMLElement | null;
            const blurNode = target?.closest("span[style*='--gomo-blur']") as HTMLSpanElement | null;

            if (!blurNode) return;

            const savedFilter = blurNode.dataset.gomoBlurFilter || blurNode.style.filter || "blur(6px)";
            const savedWebkitFilter = blurNode.dataset.gomoBlurWebkitFilter || blurNode.style.webkitFilter || "blur(6px)";

            blurNode.dataset.gomoBlurFilter = savedFilter;
            blurNode.dataset.gomoBlurWebkitFilter = savedWebkitFilter;

            if (blurNode.dataset.gomoBlurTimer) {
              window.clearTimeout(Number(blurNode.dataset.gomoBlurTimer));
            }

            blurNode.style.filter = "blur(0px)";
            blurNode.style.webkitFilter = "blur(0px)";

            const timeoutId = window.setTimeout(() => {
              concealBlurNode(blurNode);
            }, 2200);

            blurNode.dataset.gomoBlurTimer = String(timeoutId);
          }}
        >
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className={`${minHeightClassName} relative z-10 outline-none bg-transparent text-sm sm:text-base`}
                spellCheck
              />
            }
            placeholder={(
              <div className="pointer-events-none absolute inset-x-3 top-3 max-w-[calc(100%-1.5rem)] whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground/80 sm:text-base sm:leading-7">
                {placeholder}
              </div>
            )}
            ErrorBoundary={() => null}
          />
          <HistoryPlugin />
          <LinkPlugin />
          <StyleContinuationPlugin />
          <InitialContentPlugin initialState={initialState} />
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
