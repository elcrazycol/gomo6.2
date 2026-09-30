import {
  forwardRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/UserAvatar";
import { UserBadge } from "@/components/UserBadge";
import { cn } from "@/lib/utils";
import { isInteractiveTarget } from "@/utils/wallNormalizers";
import { safeDate } from "@/utils/safeDate";
import { formatShortRelativeTime } from "@/utils/relativeTimeShort";
import { useDateLocale, getIntlLanguage } from "@/i18n/dateLocale";
import { useTranslation } from "react-i18next";
import { profileUrl } from "@/utils/entityUrl";

/**
 * Shared chrome for every post card (feed, profile wall, g-sub board, topics).
 *
 * The feed's wall-post card is the design reference: a flat, rounded frame, a
 * compact header (avatar + author badge + source chip + short relative time)
 * and one borderless row of icon-only actions. These pieces keep that frame
 * identical everywhere instead of each card re-declaring it.
 */

/**
 * Flat frame shared by all post cards.
 *
 * The surface is a translucent `--card` laid over the page background, so it
 * reads as a slightly lightened version of the canvas rather than a stark
 * white block — visible separation without shouting. Kept above `--muted`
 * (chips and action hovers use it) so those stay readable inside the card.
 */
export const POST_CARD_CLASS =
  "relative overflow-clip rounded-[var(--card-radius)] border-border/70 bg-surface transition-colors hover:border-border/80 " +
  // Long feed / wall / board sessions accumulate hundreds of cards. Off-screen
  // cards now skip layout and paint entirely, so scroll depth stays cheap.
  // `auto <length>` makes the browser remember each card's real height after
  // its first render, so the 300px figure is only a placeholder for cards that
  // have never been on screen — which keeps the scrollbar from jumping.
  "[content-visibility:auto] [contain-intrinsic-size:auto_300px]";

interface PostCardShellProps {
  children: ReactNode;
  /**
   * When provided the whole card becomes a click target (and Enter/Space
   * activate it); clicks on links/buttons inside are left alone.
   */
  onOpen?: () => void;
  className?: string;
  contentClassName?: string;
  /** Accessible name for the clickable card. */
  ariaLabel?: string;
  /** Rendered in the card's bottom-right corner, revealed on hover/focus. */
  cornerAction?: ReactNode;
}

export const PostCardShell = forwardRef<HTMLDivElement, PostCardShellProps>(
  ({ children, onOpen, className, contentClassName, ariaLabel, cornerAction }, ref) => {
    const interactive = Boolean(onOpen);

    const handleClick = (event: MouseEvent<HTMLDivElement>) => {
      if (!onOpen) return;
      if (isInteractiveTarget(event.target, event.currentTarget)) return;
      onOpen();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (!onOpen) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen();
      }
    };

    return (
      <Card
        ref={ref}
        className={cn(POST_CARD_CLASS, "group/card", className)}
        onClick={interactive ? handleClick : undefined}
        onKeyDown={interactive ? handleKeyDown : undefined}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={ariaLabel}
      >
        <CardContent className={cn("space-y-4 p-3 sm:p-4", contentClassName)}>
          {children}
        </CardContent>
        {cornerAction && (
          <div className="pointer-events-none absolute bottom-2 right-2 z-10 opacity-0 transition-opacity duration-150 group-hover/card:pointer-events-auto group-hover/card:opacity-100 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 motion-reduce:transition-none">
            {cornerAction}
          </div>
        )}
      </Card>
    );
  },
);
PostCardShell.displayName = "PostCardShell";

/** Source chip ("стена", a section, a board) shown at the card's top-right. */
interface PostSourceChipProps {
  icon?: ReactNode;
  label: ReactNode;
  /** When set the chip links to that route. */
  to?: string;
  className?: string;
}

export const PostSourceChip = ({ icon, label, to, className }: PostSourceChipProps) => {
  const classes = cn(
    "inline-flex max-w-[45vw] items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-1 text-[13px] font-medium leading-none text-foreground/85 [&_svg]:text-muted-foreground/40",
    to && "transition-colors hover:text-primary",
    className,
  );
  const inner = (
    <>
      {icon}
      <span className="truncate">{label}</span>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes} onClick={(event) => event.stopPropagation()}>
        {inner}
      </Link>
    );
  }
  return <span className={classes}>{inner}</span>;
};

interface PostCardHeaderProps {
  userId: string | null;
  /** Public number of the author, for /profile/<n> links. */
  userPublicId?: number | null;
  username?: string | null;
  displayName?: string | null;
  emojiId?: string | null;
  isAnonymous?: boolean | null;
  avatarUrl?: string | null;
  /** Profile route target; defaults to `userId`. */
  profileId?: string | null;
  createdAt: string;
  /** `compact` (default) renders "5м"/"2д"; `relative` renders "5 минут назад". */
  timeStyle?: "compact" | "relative";
  /** Hide the timestamp in the compact mobile layout. */
  hideTimestampOnCompactMobile?: boolean;
  /** Chips rendered before the timestamp (source, pinned, …). */
  chips?: ReactNode;
  /** Trailing slot at the far right (management menu, …). */
  trailing?: ReactNode;
}

/**
 * Card header: avatar, author badge, and a right-aligned group of source
 * chips + relative time. Used by every post card so the top strip reads the
 * same whether the post lives in the feed, on a wall or in a topic.
 */
export const PostCardHeader = ({
  userId,
  userPublicId,
  username,
  displayName,
  emojiId,
  isAnonymous,
  avatarUrl,
  profileId,
  createdAt,
  timeStyle = "compact",
  hideTimestampOnCompactMobile = false,
  chips,
  trailing,
}: PostCardHeaderProps) => {
  const dateLocale = useDateLocale();
  const { i18n } = useTranslation();
  const date = safeDate(createdAt);
  const name = displayName?.trim() || username || undefined;
  const timeClass = hideTimestampOnCompactMobile
    ? "compact-mobile-hide"
    : undefined;

  const avatar = (
    <UserAvatar
      src={isAnonymous ? null : avatarUrl}
      userId={isAnonymous ? null : userId}
      alt={name || ""}
      className="h-8 w-8"
    />
  );
  const linkId = profileId ?? userId;
  const avatarNode =
    isAnonymous || !linkId ? (
      <span className="flex shrink-0 items-center">{avatar}</span>
    ) : (
      <Link
        to={profileUrl({ id: linkId, public_id: userPublicId })}
        onClick={(event) => event.stopPropagation()}
        className="flex shrink-0 items-center"
      >
        {avatar}
      </Link>
    );

  const timeNode =
    timeStyle === "compact" ? (
      <time
        className={cn(
          "text-sm font-medium tabular-nums text-muted-foreground",
          timeClass,
        )}
        dateTime={date.toISOString()}
        title={date.toLocaleString(getIntlLanguage(i18n.language))}
      >
        {formatShortRelativeTime(date, i18n.language)}
      </time>
    ) : (
      <span className={cn("text-xs text-muted-foreground", timeClass)}>
        {formatDistanceToNow(date, { locale: dateLocale, addSuffix: true })}
      </span>
    );

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {avatarNode}

      {/* `flex` (not a plain block) so the badge is centred as a flex item —
          as an inline-flex inside a block it baseline-aligns against the line
          box and drifts below the avatar's centre. */}
      <div className="flex min-w-0 flex-1 items-center">
        <UserBadge
          userId={userId}
          userPublicId={userPublicId}
          username={username || "Аноним"}
          displayName={displayName}
          emojiId={emojiId}
          isAnonymous={Boolean(isAnonymous)}
          disableLink={false}
          stopPropagationOnClick
        />
      </div>

      <div className="flex items-center gap-2.5">
        {chips}
        {timeNode}
        {trailing}
      </div>
    </div>
  );
};

/** Borderless row of icon-only actions shared by every post card. */
export const PostCardActions = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    data-testid="post-actions"
    className={cn("flex flex-wrap items-center gap-1 border-t border-border/50 pt-2", className)}
  >
    {children}
  </div>
);

/**
 * Grouped header + title block for cards that carry a title.
 *
 * The title sits right under the author row (a tighter gap than the card's
 * normal `space-y-4` rhythm) and a hairline separates this heading — title,
 * tags — from the post body below it.
 */
export const PostCardHeading = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div className={cn("space-y-2 border-b border-border/50 pb-3", className)}>
    {children}
  </div>
);
