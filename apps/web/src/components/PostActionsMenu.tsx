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
import { useReportedPosts } from "@/components/moderation/reportState";

interface PostActionsMenuProps {
  /**
   * Wall-post id. When present, the menu gains a "Пожаловаться" item that
   * opens the report dialog for this post (one report per user per post,
   * enforced server-side).
   */
  postId?: string;
  /** Extra menu items rendered above the report item (edit/delete/pin…). */
  children?: ReactNode;
  align?: "start" | "end";
}

/**
 * Shared three-dots actions menu for wall posts. Callers pass their own
 * management items (pin/edit/delete) as children; the report item and its
 * dialog are built in. Renders nothing when there is nothing to show.
 *
 * Non-modal on purpose: a modal Radix dropdown locks page scroll (overflow:
 * hidden on body), which kills sticky headers/composers — a plain menu doesn't
 * need the focus trap or scroll lock.
 */
export const PostActionsMenu = ({ postId, children, align = "end" }: PostActionsMenuProps) => {
  const [reportOpen, setReportOpen] = useState(false);
  const reportedPosts = useReportedPosts();
  const alreadyReported = postId ? reportedPosts.has(postId) : false;

  if (!postId && !children) return null;

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:bg-transparent data-[state=open]:text-foreground"
            title="Меню поста"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="bg-popover border-border shadow-lg">
          {children}
          {children && postId && <DropdownMenuSeparator />}
          {postId &&
            (alreadyReported ? (
              <DropdownMenuItem
                disabled
                className="px-3 py-2 text-muted-foreground"
                title="Вы уже пожаловались на эту запись"
              >
                <BadgeCheck className="h-4 w-4 mr-3 text-green-600" />
                Вы уже пожаловались
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => setReportOpen(true)}
                className="cursor-pointer text-orange-600 hover:bg-orange-500/15 hover:text-orange-600 focus:bg-orange-500/15 focus:text-orange-600 transition-colors px-3 py-2"
                title="Пожаловаться"
              >
                <Flag className="h-4 w-4 mr-3" />
                Пожаловаться
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {postId && (
        <ReportDialog open={reportOpen} onOpenChange={setReportOpen} postId={postId} />
      )}
    </>
  );
};