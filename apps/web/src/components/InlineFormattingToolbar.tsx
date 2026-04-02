import { Button } from "@/components/ui/button";
import { Bold, Italic, Underline, Strikethrough, Palette, Type, Eye, Zap } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RichTextEditorHandle } from "@/components/RichTextEditor";

// Helper function to extract plain text from element (similar to RichTextEditor)
function extractPlainTextFromNode(root: HTMLElement): string {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const v = node.nodeValue ?? "";
      out.push(v.replace(/\u200B/g, "")); // Remove zero-width spaces
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "BR") out.push("\n");
      if (el.dataset?.emojiOriginal) out.push(el.dataset.emojiOriginal);
    }
    node = walker.nextNode();
  }
  return out.join("");
}

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
      // RichTextEditor support - wrap selected text or insert tags
      const el = editorRef.current.getElement();
      if (!el) return;
      
      el.focus();
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        // No selection - just insert tags
        editorRef.current.insertText(prefix + suffix);
        return;
      }
      
      const range = selection.getRangeAt(0);
      if (range.collapsed) {
        // No text selected - just insert tags
        editorRef.current.insertText(prefix + suffix);
        return;
      }
      
      // Text is selected - wrap it with tags
      // Get the plain text from the selection using the editor's method
      const selectedText = range.toString();
      if (!selectedText || selectedText.trim().length === 0) {
        // No text selected - just insert tags
      editorRef.current.insertText(prefix + suffix);
        return;
      }
      
      // Get current value and selection positions
      const currentValue = editorRef.current.getValue();
      const selectionStart = editorRef.current.getSelectionStart();
      const selectionEnd = selectionStart; // Since getSelectionStart returns end when text is selected
      
      // Calculate actual start position (selectionStart might be at end of selection)
      // We need to find where the selection actually starts
      const rangeClone = range.cloneRange();
      rangeClone.selectNodeContents(el);
      rangeClone.setEnd(range.startContainer, range.startOffset);
      const startOffset = extractPlainTextFromNode(el).substring(0, rangeClone.toString().length).length;
      const endOffset = startOffset + selectedText.length;
      
      // Insert tags around selected text
      const newValue = 
        currentValue.substring(0, startOffset) + 
        prefix + selectedText + suffix + 
        currentValue.substring(endOffset);
      
      // Use document.execCommand to replace selection (this will trigger input event)
      range.deleteContents();
      const textNode = document.createTextNode(prefix + selectedText + suffix);
      range.insertNode(textNode);
      
      // Move cursor after inserted text
      const newRange = document.createRange();
      newRange.setStartAfter(textNode);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
      
      // Trigger change event manually
      el.dispatchEvent(new Event('input', { bubbles: true }));
      
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
      <div className="flex gap-0.5 sm:gap-1 flex-nowrap relative z-50 overflow-x-auto scrollbar-hide max-w-full">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 sm:h-8 sm:w-8 p-0 flex-shrink-0"
              onClick={() => insertFormatting("[B]", "[/B]")}
            >
              <Bold className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
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
              className="h-7 w-7 sm:h-8 sm:w-8 p-0 flex-shrink-0"
              onClick={() => insertFormatting("[I]", "[/I]")}
            >
              <Italic className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
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
              className="h-7 w-7 sm:h-8 sm:w-8 p-0 flex-shrink-0"
              onClick={() => insertFormatting("[U]", "[/U]")}
            >
              <Underline className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
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
              className="h-7 w-7 sm:h-8 sm:w-8 p-0 flex-shrink-0"
              onClick={() => insertFormatting("[S]", "[/S]")}
            >
              <Strikethrough className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
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
              className="h-7 w-7 sm:h-8 sm:w-8 p-0 flex-shrink-0"
              onClick={() => insertFormatting("[col=#ff0000]", "[/col]")}
            >
              <Palette className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
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
              className="h-7 w-7 sm:h-8 sm:w-8 p-0 flex-shrink-0"
              onClick={() => insertFormatting("[size=2]", "[/size]")}
            >
              <Type className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
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
              className="h-7 w-7 sm:h-8 sm:w-8 p-0 flex-shrink-0"
              onClick={() => insertFormatting("[blur]", "[/blur]")}
            >
              <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
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
              className="h-7 w-7 sm:h-8 sm:w-8 p-0 flex-shrink-0"
              onClick={() => insertFormatting("[spoiler]", "[/spoiler]")}
            >
              <Zap className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
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