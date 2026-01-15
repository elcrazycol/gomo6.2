import { Button } from "@/components/ui/button";
import { Bold, Italic, Underline, Strikethrough, Palette, Type, Eye, Zap } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RichTextEditorHandle } from "@/components/RichTextEditor";

interface InlineFormattingToolbarProps {
  editorRef?: React.RefObject<RichTextEditorHandle>;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  onFormat?: (prefix: string, suffix: string) => void;
}

export const InlineFormattingToolbar = ({ editorRef, textareaRef, onFormat }: InlineFormattingToolbarProps) => {
  const insertFormatting = (prefix: string, suffix: string = "") => {
    if (onFormat) {
      // Legacy support for onFormat callback
      onFormat(prefix, suffix);
      return;
    }

    if (editorRef?.current) {
      // RichTextEditor support
      editorRef.current.insertText(prefix + suffix);
      setTimeout(() => {
        editorRef.current?.focus();
      }, 0);
    } else if (textareaRef?.current) {
      // Regular textarea support
      const textarea = textareaRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = textarea.value.substring(start, end);
      const newText = textarea.value.substring(0, start) + prefix + selectedText + suffix + textarea.value.substring(end);

      // Update textarea value
      textarea.value = newText;
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selectedText.length);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex gap-1 flex-wrap relative z-50">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => insertFormatting("[B]", "[/B]")}
            >
              <Bold className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="z-50" side="top">
            <p>Жирный текст (Ctrl+B)</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => insertFormatting("[I]", "[/I]")}
            >
              <Italic className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="z-50" side="top">
            <p>Курсив (Ctrl+I)</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => insertFormatting("[U]", "[/U]")}
            >
              <Underline className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="z-50" side="top">
            <p>Подчеркнутый</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => insertFormatting("[S]", "[/S]")}
            >
              <Strikethrough className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="z-50" side="top">
            <p>Зачеркнутый</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => insertFormatting("[col=#ff0000]", "[/col]")}
            >
              <Palette className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="z-50" side="top">
            <p>Цвет текста</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => insertFormatting("[size=2]", "[/size]")}
            >
              <Type className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="z-50" side="top">
            <p>Размер текста</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => insertFormatting("[blur]", "[/blur]")}
            >
              <Eye className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="z-50" side="top">
            <p>Blur-спойлер</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => insertFormatting("[spoiler]", "[/spoiler]")}
            >
              <Zap className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="z-50" side="top">
            <p>SPOILER</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
};