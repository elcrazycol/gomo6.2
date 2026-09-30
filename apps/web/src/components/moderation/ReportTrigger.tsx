import { useState } from "react";
import { Flag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ReportDialog } from "@/components/moderation/ReportDialog";
import { useIsReported } from "@/components/moderation/reportState";

interface ReportTriggerProps {
  targetType: string;
  targetId: string;
  /**
   * "icon" — a compact ghost icon button for a desktop action row;
   * "sheet" — a full-width item for a mobile bottom sheet.
   */
  variant?: "icon" | "sheet";
  /** Called before opening the dialog (e.g. close the surrounding sheet). */
  onBeforeOpen?: () => void;
}

/**
 * Self-contained report trigger + dialog for surfaces that own their own action
 * menu (thread posts, wall comments). Renders nothing special once reported —
 * the control just turns into a disabled "уже пожаловались" state.
 */
export const ReportTrigger = ({ targetType, targetId, variant = "icon", onBeforeOpen }: ReportTriggerProps) => {
  const [open, setOpen] = useState(false);
  const alreadyReported = useIsReported(targetType, targetId);

  const openDialog = () => {
    onBeforeOpen?.();
    setOpen(true);
  };

  return (
    <>
      {variant === "sheet" ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 justify-start rounded-xl text-orange-600 hover:text-orange-600"
          disabled={alreadyReported}
          onClick={openDialog}
        >
          <Flag className="mr-2 h-4 w-4" />
          {alreadyReported ? "Вы уже пожаловались" : "Пожаловаться"}
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-orange-600"
          title={alreadyReported ? "Вы уже пожаловались" : "Пожаловаться"}
          disabled={alreadyReported}
          onClick={openDialog}
        >
          <Flag className="h-3.5 w-3.5" />
        </Button>
      )}
      <ReportDialog open={open} onOpenChange={setOpen} targetType={targetType} targetId={targetId} />
    </>
  );
};
