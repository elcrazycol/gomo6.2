import { type ReactNode, useState } from "react";
import { BadgeCheck, Flag, MoreVertical } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ReportDialog } from "@/components/moderation/ReportDialog";
import { useIsReported } from "@/components/moderation/reportState";

interface PostActionsMenuProps {
  /**
   * Polymorphic report target ("wall_post" | "thread" | "post" | "wall_comment"
   * | "user" | "gomosub"). When set, the menu gains a "Пожаловаться" item that
   * opens the report dialog (one report per user per target, enforced
   * server-side).
   */
  targetType?: string;
  targetId?: string;
  /** Menu item label (default "Пожаловаться"). */
  reportLabel?: string;
  /** Dialog title suffix, e.g. "на запись". */
  reportTargetLabel?: string;
  /** Extra menu items rendered above the report item (edit/delete/pin…). */
  children?: ReactNode;
  align?: "start" | "end";
  /** Trigger button tooltip. */
  triggerTitle?: string;
}

/**
 * Shared three-dots actions menu. Callers pass their own management items
 * (pin/edit/delete) as children; the report item and its dialog are built in.
 * Renders nothing when there is nothing to show.
 *
 * Non-modal on purpose: a modal Radix dropdown locks page scroll (overflow:
 * hidden on body), which kills sticky headers/composers — a plain menu doesn't
 * need the focus trap or scroll lock.
 */
export const PostActionsMenu = ({
  targetType,
  targetId,
  reportLabel = "Пожаловаться",
  reportTargetLabel,
  children,
  align = "end",
  triggerTitle = "Меню",
}: PostActionsMenuProps) => {
  const [reportOpen, setReportOpen] = useState(false);
  const canReport = Boolean(targetType && targetId);
  const alreadyReported = useIsReported(targetType ?? "", targetId ?? "");

  if (!canReport && !children) return null;

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:bg-transparent data-[state=open]:text-foreground"
            title={triggerTitle}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="bg-popover border-border shadow-lg">
          {children}
          {children && canReport && <DropdownMenuSeparator />}
          {canReport &&
            (alreadyReported ? (
              <DropdownMenuItem
                disabled
                className="px-3 py-2 text-muted-foreground"
                title="Вы уже пожаловались"
              >
                <BadgeCheck className="h-4 w-4 mr-3 text-green-600" />
                Вы уже пожаловались
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => setReportOpen(true)}
                className="cursor-pointer text-orange-600 hover:bg-orange-500/15 hover:text-orange-600 focus:bg-orange-500/15 focus:text-orange-600 transition-colors px-3 py-2"
                title={reportLabel}
              >
                <Flag className="h-4 w-4 mr-3" />
                {reportLabel}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {canReport && (
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          targetType={targetType!}
          targetId={targetId!}
          targetLabel={reportTargetLabel}
        />
      )}
    </>
  );
};
