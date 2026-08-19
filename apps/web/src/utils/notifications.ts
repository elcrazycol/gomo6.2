import type { Notification } from "@/integrations/api/client";
import { getWallPostPath } from "@/utils/wallNormalizers";

/** Wall-event notification types (see backend CreateWallNotification). */
export const WALL_NOTIFICATION_TYPES = new Set([
  "wall_post",
  "wall_post_like",
  "wall_comment",
  "wall_comment_reply",
  "wall_repost",
]);

export function isWallNotification(type: string): boolean {
  return WALL_NOTIFICATION_TYPES.has(type);
}

/**
 * Resolve the navigation target for a notification. Wall events deep-link to
 * the wall post page, friend events to the actor's profile, forum events to
 * the thread (using the board slug when it has been resolved).
 */
export function notificationLink(notif: Notification, threadSlug?: string): string {
  const { type } = notif;

  if (isWallNotification(type)) {
    const ownerId = notif.related_wall_user_id || notif.user_id;
    if (notif.related_wall_post_id && ownerId) {
      return getWallPostPath(ownerId, notif.related_wall_post_id);
    }
    return ownerId ? `/profile/${ownerId}` : "#";
  }

  if (type === "friend_request" || type === "friend_accepted") {
    return notif.related_user_id ? `/profile/${notif.related_user_id}` : "#";
  }

  if (notif.related_thread_id) {
    return threadSlug
      ? `/${threadSlug}/thread/${notif.related_thread_id}`
      : `/notify?thread=${notif.related_thread_id}`;
  }

  return "#";
}
