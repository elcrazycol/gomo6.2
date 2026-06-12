import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { processEmojiText } from "@/utils/emojiUtils.tsx";

const TAB_SPACES = "    ";

interface EmojiTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  disabled?: boolean;
  className?: string;
  autoExpand?: boolean;
  maxRows?: number;
}

export const EmojiTextarea = forwardRef<HTMLTextAreaElement, EmojiTextareaProps>(({
  value,
  onChange,
  placeholder,
  onKeyDown,
  disabled,
  className = "",
  autoExpand = true,
  maxRows = 5
}, ref) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPosition, setCursorPosition] = useState(0);

  useImperativeHandle(ref, () => textareaRef.current!, []);

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    const newValue = target.value;
    setCursorPosition(target.selectionStart);
    onChange(newValue);
  };

  const handleKeyDownInternal = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;

    if (e.key === "Tab") {
      e.preventDefault();
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const newValue = value.substring(0, start) + TAB_SPACES + value.substring(end);
      onChange(newValue);
      setCursorPosition(start + TAB_SPACES.length);
    } else if (e.key === "Backspace" && target.selectionStart === target.selectionEnd) {
      const start = target.selectionStart;
      const textBeforeCaret = value.slice(0, start);

      if (textBeforeCaret.endsWith(TAB_SPACES)) {
        e.preventDefault();
        const newValue = value.slice(0, start - TAB_SPACES.length) + value.slice(start);
        onChange(newValue);
        setCursorPosition(start - TAB_SPACES.length);
      }
    }

    if (onKeyDown) {
      onKeyDown(e);
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea && cursorPosition !== textarea.selectionStart) {
      textarea.setSelectionRange(cursorPosition, cursorPosition);
    }
  }, [value, cursorPosition]);

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDownInternal}
        placeholder={placeholder}
        disabled={disabled}
        autoExpand={autoExpand}
        maxRows={maxRows}
        className={`${className} relative`}
      />
      {/* Emoji preview overlay */}
      <div className="absolute inset-0 pointer-events-none bg-transparent z-10 p-3">
        <div className="flex flex-wrap items-center gap-1 text-sm sm:text-base leading-relaxed">
          {processEmojiText(value, 'overlay')}
        </div>
      </div>
    </div>
  );
});

EmojiTextarea.displayName = "EmojiTextarea";

// Import Textarea component

