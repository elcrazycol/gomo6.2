import { useEffect, useRef, useState, useCallback } from "react";
import { renderPreviewContent } from "@/utils/emojiUtils.tsx";

interface EmojiPreviewProps {
  content: string;
  onContentChange: (content: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  className?: string;
}

export const EmojiPreview = ({ content, onContentChange, textareaRef, className = "" }: EmojiPreviewProps) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const [isComposing, setIsComposing] = useState(false);

  // Sync preview dimensions and scroll with textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    const preview = previewRef.current;

    if (!textarea || !preview) return;

    const syncStyles = () => {
      const rect = textarea.getBoundingClientRect();
      preview.style.width = `${rect.width}px`;
      preview.style.height = `${rect.height}px`;

      const computedStyle = window.getComputedStyle(textarea);
      preview.style.padding = computedStyle.padding;
      preview.style.fontSize = computedStyle.fontSize;
      preview.style.fontFamily = computedStyle.fontFamily;
      preview.style.lineHeight = computedStyle.lineHeight;
      preview.style.wordWrap = 'break-word';
      preview.style.whiteSpace = 'pre-wrap';
      preview.style.overflowWrap = 'break-word';
    };

    const syncScroll = () => {
      preview.scrollTop = textarea.scrollTop;
      preview.scrollLeft = textarea.scrollLeft;
    };

    // Initial sync
    syncStyles();
    syncScroll();

    // Sync on textarea changes
    const resizeObserver = new ResizeObserver(syncStyles);
    resizeObserver.observe(textarea);

    textarea.addEventListener('scroll', syncScroll);
    textarea.addEventListener('input', syncStyles);

    return () => {
      resizeObserver.disconnect();
      textarea.removeEventListener('scroll', syncScroll);
      textarea.removeEventListener('input', syncStyles);
    };
  }, [textareaRef]);

  // Handle keyboard events for proper emoji deletion
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isComposing) return;

      if (e.key === 'Backspace') {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        // If there's a selection, let the browser handle it normally
        if (start !== end) return;

        // Find emoji sequences before cursor
        const textBeforeCursor = content.substring(0, start);
        const emojiRegex = /(:[^:\s]+:)$/;
        const match = textBeforeCursor.match(emojiRegex);

        if (match) {
          e.preventDefault();
          const emojiStart = start - match[1].length;
          const newContent = content.substring(0, emojiStart) + content.substring(start);
          onContentChange(newContent);

          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = emojiStart;
          }, 0);
        }
      }
    };

    const handleCompositionStart = () => setIsComposing(true);
    const handleCompositionEnd = () => setIsComposing(false);

    textarea.addEventListener('keydown', handleKeyDown);
    textarea.addEventListener('compositionstart', handleCompositionStart);
    textarea.addEventListener('compositionend', handleCompositionEnd);

    return () => {
      textarea.removeEventListener('keydown', handleKeyDown);
      textarea.removeEventListener('compositionstart', handleCompositionStart);
      textarea.removeEventListener('compositionend', handleCompositionEnd);
    };
  }, [content, onContentChange, textareaRef, isComposing]);

  return (
    <div
      ref={previewRef}
      className={`absolute inset-0 z-10 ${className}`}
      style={{
        padding: 'inherit',
        color: 'inherit',
        backgroundColor: 'var(--background)',
        pointerEvents: 'none',
        userSelect: 'none',
        outline: 'none',
      }}
    >
      {renderPreviewContent(content, 'preview')}
    </div>
  );
};