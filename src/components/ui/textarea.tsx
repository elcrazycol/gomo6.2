import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoExpand?: boolean;
  maxRows?: number;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoExpand = false, maxRows = 5, ...props }, ref) => {
    const internalRef = React.useRef<HTMLTextAreaElement>(null);
    const textareaRef = (ref as React.RefObject<HTMLTextAreaElement>) || internalRef;

    React.useEffect(() => {
      if (!autoExpand || !textareaRef.current) return;

      const textarea = textareaRef.current;
      
      const adjustHeight = () => {
        textarea.style.height = 'auto';
        const scrollHeight = textarea.scrollHeight;
        const lineHeight = parseInt(getComputedStyle(textarea).lineHeight);
        const maxHeight = lineHeight * maxRows;
        
        if (scrollHeight > maxHeight) {
          textarea.style.height = `${maxHeight}px`;
          textarea.style.overflowY = 'auto';
        } else {
          textarea.style.height = `${scrollHeight}px`;
          textarea.style.overflowY = 'hidden';
        }
      };

      adjustHeight();
      textarea.addEventListener('input', adjustHeight);
      
      return () => textarea.removeEventListener('input', adjustHeight);
    }, [autoExpand, maxRows, textareaRef, props.value]);

  return (
    <textarea
      className={cn(
        "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none transition-all duration-200",
        autoExpand ? "min-h-[40px]" : "min-h-[80px]",
        className,
      )}
      enterKeyHint={props.enterKeyHint ?? "enter"}
      inputMode={props.inputMode ?? "text"}
      ref={textareaRef}
      {...props}
    />
  );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
