import { useState } from "react";
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
  compact = false,
}: WallCommentComposerProps) => {
  const [localResetKey, setLocalResetKey] = useState(0);
  const key = resetKey ?? localResetKey;

  return (
    <div className="space-y-2">
      <GomoRichEditor
        resetKey={key}
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
