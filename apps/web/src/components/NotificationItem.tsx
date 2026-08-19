import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { useDateLocale } from "@/i18n/dateLocale";
import {
  Bell,
  CornerDownRight,
  Gift,
  Heart,
  MessageCircle,
  Pencil,
  Repeat2,
  Trophy,
  UserCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import type { Notification } from "@/integrations/api/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NotificationThumb } from "@/components/NotificationThumb";
import { useProfileCache } from "@/contexts/ProfileCacheContext";
import { notificationLink, notificationTitle } from "@/utils/notifications";
import { storageUrl } from "@/utils/storage";
import { safeDate } from "@/utils/safeDate";

interface TypeStyle {
  Icon: LucideIcon;
  text: string;
  bg: string;
}

const TYPE_STYLES: Record<string, TypeStyle> = {
  like: { Icon: Heart, text: "text-rose-500", bg: "bg-rose-500/15" },
  wall_post_like: { Icon: Heart, text: "text-rose-500", bg: "bg-rose-500/15" },
  reply: { Icon: CornerDownRight, text: "text-sky-500", bg: "bg-sky-500/15" },
  wall_comment: { Icon: MessageCircle, text: "text-sky-500", bg: "bg-sky-500/15" },
  wall_comment_reply: { Icon: CornerDownRight, text: "text-sky-500", bg: "bg-sky-500/15" },
  wall_repost: { Icon: Repeat2, text: "text-emerald-500", bg: "bg-emerald-500/15" },
  wall_post: { Icon: Pencil, text: "text-sky-500", bg: "bg-sky-500/15" },
  friend_request: { Icon: UserPlus, text: "text-sky-500", bg: "bg-sky-500/15" },
  friend_accepted: { Icon: UserCheck, text: "text-emerald-500", bg: "bg-emerald-500/15" },
  gift_received: { Icon: Gift, text: "text-purple-500", bg: "bg-purple-500/15" },
  achievement_unlock: { Icon: Trophy, text: "text-amber-500", bg: "bg-amber-500/15" },
};

const DEFAULT_STYLE: TypeStyle = { Icon: Bell, text: "text-muted-foreground", bg: "bg-muted" };

interface NotificationItemProps {
  notification: Notification;
  /** Board slug resolved for forum (thread) notifications. */
  threadSlug?: string;
  /** Called when the row is opened — the store marks it read. */
  onOpen?: (id: string) => void;
  /** Hide the unread indicator (used when the page already groups by read state). */
  hideUnreadDot?: boolean;
}

export const NotificationItem = ({ notification, threadSlug, onOpen, hideUnreadDot }: NotificationItemProps) => {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const { loadProfile } = useProfileCache();
  const [actor, setActor] = useState<{ avatarUrl?: string; username?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const userId = notification.related_user_id;
    if (!userId) {
      setActor(null);
      return;
    }
    loadProfile(userId).then((p) => {
      if (!cancelled) setActor({ avatarUrl: p.avatarUrl, username: p.username });
    });
    return () => {
      cancelled = true;
    };
  }, [notification.related_user_id, loadProfile]);

  const style = TYPE_STYLES[notification.type] ?? DEFAULT_STYLE;
  const { Icon } = style;
  const link = notificationLink(notification, threadSlug);
  const avatarSrc = storageUrl("post-images", actor?.avatarUrl);
  const title = notificationTitle(notification, t);
  const fallback = (actor?.username || title).trim().charAt(0).toUpperCase() || "?";

  // The title is "@username did something" — bold the leading @handle for the
  // X look. Friend/gift/achievement titles may not carry a handle, in which
  // case the whole title renders uniformly.
  const firstSpace = title.indexOf(" ");
  const lead = firstSpace > 0 ? title.slice(0, firstSpace) : title;
  const rest = firstSpace > 0 ? title.slice(firstSpace) : "";
  const leadIsHandle = lead.startsWith("@");

  const body = (
    <div
      className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors sm:px-4 ${
        !notification.is_read ? "bg-primary/[0.04]" : "hover:bg-muted/50"
      }`}
    >
      <div className="relative shrink-0">
        {actor?.avatarUrl ? (
          <Avatar className="h-9 w-9 border border-border/60">
            <AvatarImage src={avatarSrc ?? undefined} alt={actor.username || "Avatar"} />
            <AvatarFallback className="bg-muted text-xs font-medium text-muted-foreground">{fallback}</AvatarFallback>
          </Avatar>
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-muted">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <span className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-background ring-1 ring-border/40`}>
          <span className={`flex h-4 w-4 items-center justify-center rounded-full ${style.bg}`}>
            <Icon className={`h-2.5 w-2.5 ${style.text}`} />
          </span>
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5 text-foreground">
          {leadIsHandle ? (
            <>
              <span className="font-semibold">{lead}</span>
              <span className="text-foreground/90">{rest}</span>
            </>
          ) : (
            <span className="font-medium">{title}</span>
          )}
          {notification.message ? (
            <span className="text-muted-foreground"> {notification.message}</span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDistanceToNow(safeDate(notification.created_at), { locale: dateLocale, addSuffix: true })}
        </p>
      </div>

      {notification.related_wall_post_id || notification.related_post_id || notification.related_thread_id ? (
        <NotificationThumb notification={notification} />
      ) : null}

      {!hideUnreadDot && !notification.is_read && (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
      )}
    </div>
  );

  // A wall_post_like burst (>1 liked post) gets a footer that opens a
  // dedicated page listing exactly those posts — the X "show N posts" pattern.
  const likeCount = notification.related_wall_post_ids?.length ?? 0;
  const showLikes = notification.type === "wall_post_like" && likeCount > 1;

  const row = link === "#" ? (
    <button type="button" className="block w-full" onClick={() => onOpen?.(notification.id)}>
      {body}
    </button>
  ) : (
    <Link to={link} className="block w-full" onClick={() => onOpen?.(notification.id)}>
      {body}
    </Link>
  );

  if (!showLikes) {
    return row;
  }

  return (
    <div>
      {row}
      <Link
        to={`/notify/wall-likes/${notification.id}`}
        className="block w-full px-4 pb-3 text-left text-sm font-medium text-primary transition-colors hover:text-primary/80 sm:pl-16"
        onClick={(e) => {
          // Mark read without following the row link above.
          e.stopPropagation();
          onOpen?.(notification.id);
        }}
      >
        {t("notif.showPosts", { count: likeCount })}
      </Link>
    </div>
  );
};
