import { useRef, useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiClient } from "@/integrations/api/client";
import { markReported } from "@/components/moderation/reportState";

export const REPORT_CATEGORIES = [
  { value: "spam", label: "Спам/реклама" },
  { value: "abuse", label: "Оскорбления" },
  { value: "hate", label: "Разжигание ненависти" },
  { value: "fraud", label: "Мошенничество" },
  { value: "explicit", label: "Взрослый контент" },
  { value: "other", label: "Другое" },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["value"];

// Mirrors the backend validation (content_reports CHECK + handler).
export const REPORT_MIN_REASON = 10;
export const REPORT_MAX_REASON = 2000;

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: string;
}

/**
 * Report-a-post form: category chips + a free-text description. One report per
 * user per post — the backend returns 409 with code `report_already_exists`
 * for duplicates, which is rendered as a friendly toast.
 */
export const ReportDialog = ({ open, onOpenChange, postId }: ReportDialogProps) => {
  const [category, setCategory] = useState<ReportCategory>("spam");
  // The reason is tracked only for the char counter / submit gate. The textarea
  // itself is UNCONTROLLED (ref-based): controlled textareas on some mobile
  // keyboards/IMEs occasionally swallow characters (spaces included) when the
  // value round-trips through React state, so the text is read straight from
  // the DOM at submit time and nothing the user types can be lost.
  const [reasonPreview, setReasonPreview] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setCategory("spam");
    setReasonPreview("");
    if (reasonRef.current) reasonRef.current.value = "";
    setSubmitting(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const trimmed = reasonPreview.trim();
  const canSubmit = trimmed.length >= REPORT_MIN_REASON && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const rawReason = reasonRef.current?.value ?? "";
      const reason = rawReason.trim();
      if (reason.length < REPORT_MIN_REASON) {
        setSubmitting(false);
        return;
      }
      await apiClient.rawRequest("/api/v1/moderation/reports", {
        method: "POST",
        body: JSON.stringify({ post_id: postId, category, reason }),
      });
      markReported(postId);
      toast.success("Жалоба отправлена. Спасибо!");
      handleClose(false);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === "report_already_exists") {
        // A duplicate means the report is already on file — treat it as
        // reported so the menu blocks further attempts immediately.
        markReported(postId);
        toast.error("Вы уже пожаловались на эту запись");
        handleClose(false);
      } else {
        toast.error(e.message || "Не удалось отправить жалобу");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-orange-500" />
            Пожаловаться на запись
          </DialogTitle>
          <DialogDescription>
            Расскажите, что не так с этой записью — модераторы увидят жалобу сразу.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <div className="mb-2 text-sm font-medium">Причина</div>
            <div className="flex flex-wrap gap-2">
              {REPORT_CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition-colors",
                    category === c.value
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Описание проблемы</span>
              <span className="text-xs text-muted-foreground">
                {trimmed.length}/{REPORT_MAX_REASON}
              </span>
            </div>
            <textarea
              ref={reasonRef}
              defaultValue=""
              onChange={(e) => setReasonPreview(e.target.value.slice(0, REPORT_MAX_REASON))}
              placeholder="Опишите проблему подробнее…"
              rows={4}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
            />
            {trimmed.length > 0 && trimmed.length < REPORT_MIN_REASON && (
              <p className="mt-1 text-xs text-muted-foreground">
                Опишите проблему чуть подробнее (минимум {REPORT_MIN_REASON} символов).
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => handleClose(false)}>
            Отмена
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Отправляем
              </>
            ) : (
              "Отправить жалобу"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};