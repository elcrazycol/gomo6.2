import type { TFunction } from "i18next";
import type { Notification } from "@/integrations/api/client";
import { getWallPostPath } from "@/utils/wallNormalizers";

/** Structured, language-neutral display data carried by new notifications. */
export interface NotificationParams {
  actor?: string;
  anonymous?: boolean;
  gift_name?: string;
  achievement_name?: string;
  count?: number;
}

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

/**
 * Decide which content a notification should preview with a thumbnail. Wall
 * events preview the wall post; a reply previews its thread; a like previews
 * the liked post (or the thread when it is a thread-like).
 */
export function notificationThumbTarget(notif: Notification): { kind: "wall" | "post" | "thread"; id: string } | null {
  if (notif.related_wall_post_id) return { kind: "wall", id: notif.related_wall_post_id };
  if (notif.type === "reply") {
    return notif.related_thread_id ? { kind: "thread", id: notif.related_thread_id } : null;
  }
  if (notif.related_post_id) return { kind: "post", id: notif.related_post_id };
  if (notif.related_thread_id) return { kind: "thread", id: notif.related_thread_id };
  return null;
}

/**
 * Build the localized display title for a notification from its `type` plus the
 * structured `params` payload. New rows (post-migration) store no Russian text —
 * the same row renders in the viewer's language. Legacy rows that predate the
 * migration still carry a baked `title`, which we fall back to when `params` is
 * empty.
 */
export function notificationTitle(notif: Notification, t: TFunction): string {
  const params = notif.params as NotificationParams | undefined;
  if (params && Object.keys(params).length > 0) {
    switch (notif.type) {
      case "like":
        // A like with a related post is a post-like; without one it is a thread-like.
        return notif.related_post_id
          ? t("notif.likePost", { actor: params.actor })
          : t("notif.likeThread", { actor: params.actor });
      case "reply":
        return t("notif.reply", { actor: params.actor });
      case "wall_post":
        return t("notif.wallPost", { actor: params.actor });
      case "wall_post_like":
        return (params.count ?? 0) > 1
          ? t("notif.wallPostLikeGroup", { actor: params.actor, count: params.count })
          : t("notif.wallPostLike", { actor: params.actor });
      case "wall_comment":
        return t("notif.wallComment", { actor: params.actor });
      case "wall_comment_reply":
        return t("notif.wallCommentReply", { actor: params.actor });
      case "wall_repost":
        return t("notif.wallRepost", { actor: params.actor });
      case "friend_request":
        return t("notif.friendRequest", { actor: params.actor });
      case "friend_accepted":
        return t("notif.friendAccepted", { actor: params.actor });
      case "gift_received":
        return params.anonymous
          ? t("notif.giftReceivedAnonymous", { gift: params.gift_name })
          : t("notif.giftReceived", { actor: params.actor, gift: params.gift_name });
      case "achievement_unlock":
        return t("notif.achievementUnlock", { name: params.achievement_name });
    }
  }
  return notif.title || "";
}
