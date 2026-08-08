import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GomoRichEditor } from "@/components/GomoRichEditor";

interface WallCommentComposerProps {
  placeholder: string;
  onSubmit: () => void;
  onCancel?: () => void;
  isSubmitting: boolean;
  json: unknown;
  text: string;
  onChange: (v: { json: unknown; text: string }) => void;
  resetKey?: number;
  /** Maximum number of characters for a comment. Defaults to 4000. */
  maxLength?: number;
  compact?: boolean;
}

export const WallCommentComposer = ({
  placeholder,
  onSubmit,
  onCancel,
  isSubmitting,
  json,
  text,
  onChange,
  resetKey,
  maxLength = 4000,
  compact = false,
}: WallCommentComposerProps) => {
  return (
    <div className="space-y-2">
      <GomoRichEditor
        resetKey={resetKey}
        maxLength={maxLength}
        contentJson={json}
        legacyContent={text}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={placeholder}
        minHeightClassName={compact ? "min-h-[60px]" : "min-h-[84px]"}
      />
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Отмена
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={onSubmit}
          disabled={isSubmitting || !text.trim() || /^\u200b+$/.test(text.trim()) || text.trim() === "\u200b"}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Отправляем
            </>
          ) : (
            <>
              <Send className="mr-1 h-3 w-3" />
              Ответить
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
