import { Link } from "react-router-dom";
import { ProfileHoverCard } from "./ProfileHoverCard";
import { parseCssToStyle } from "@/utils/profileCustomization";
import { useProfileCustomization } from "@/hooks/useProfileCustomization";
import { AdminBadge } from "./AdminBadge";
import { NicknameEmoji } from "./NicknameEmoji";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface UserBadgeProps {
  userId: string | null;
  username: string;
  displayName?: string | null;
  /** custom_emojis id shown right of the nickname (users.nickname_emoji_id) */
  emojiId?: string | null;
  isAnonymous?: boolean;
  disableLink?: boolean;
  disableHoverCard?: boolean;
  stopPropagationOnClick?: boolean;
  isThreadOpener?: boolean;
  className?: string;
}

export const UserBadge = ({
  userId,
  username,
  displayName,
  emojiId,
  isAnonymous,
  disableLink = false,
  disableHoverCard = false,
  stopPropagationOnClick = false,
  isThreadOpener,
  className,
}: UserBadgeProps) => {
  // Re-reads whenever the Profile Studio publishes an edit, so a nickname
  // style changed there lands on every mounted badge at once instead of only
  // after a remount.
  const customization = useProfileCustomization(userId, !isAnonymous);

  // One nickname style everywhere: bold, inheriting the surrounding text colour,
  // one size. The old `showOutline` flag is gone — it painted the nickname in
  // the theme's quote accent and added a white 1px drop-shadow halo (a leftover
  // from badges drawn on the coloured board header), and it also flipped the
  // size between 16px and 12–14px depending on which call site remembered to
  // opt out. Both effects were unwanted on normal surfaces.
  const usernameClassName = "font-bold text-sm hover:underline";

  if (isAnonymous || !userId) {
    return <span className={`font-bold text-sm ${className ?? ""}`}>Аноним</span>;
  }

  // Apply customization CSS if available
  const usernameStyle = customization?.username_css
    ? parseCssToStyle(customization.username_css)
    : {};

  const badgeStyle = customization?.profile_badge_css
    ? parseCssToStyle(customization.profile_badge_css)
    : {};

  const usernameContent = (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
      <span className={usernameClassName} style={usernameStyle}>
        {displayName?.trim() || username}
      </span>
      {emojiId && <NicknameEmoji emojiId={emojiId} />}
      {customization?.profile_badge_text && (
        <span
          className="px-2 py-0.5 rounded text-xs font-medium ml-1"
          style={badgeStyle}
        >
          {customization.profile_badge_text}
        </span>
      )}
      {userId && <AdminBadge userId={userId} />}
      {/* Thread Opener Badge */}
      {isThreadOpener && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-primary text-primary-foreground rounded cursor-help">
                TO
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>открыватель записи:D</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </span>
  );

  const badgeContent = disableLink ? (
    <ProfileHoverCard userId={userId} disabled={disableHoverCard}>
      {usernameContent}
    </ProfileHoverCard>
  ) : (
    <ProfileHoverCard userId={userId} disabled={disableHoverCard}>
      <Link
        to={`/profile/${userId}`}
        className="inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden"
        onClick={stopPropagationOnClick ? (event) => event.stopPropagation() : undefined}
      >
        {usernameContent}
      </Link>
    </ProfileHoverCard>
  );

  return className ? (
    <span className={className}>{badgeContent}</span>
  ) : badgeContent;
};
