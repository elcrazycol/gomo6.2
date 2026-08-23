import type { TFunction } from "i18next";
import type { Notification } from "@/integrations/api/client";
import { getWallPostPath } from "@/utils/wallNormalizers";

/** Structured, language-neutral display data carried by new notifications. */
export interface NotificationParams {
  actor?: string;
  anonymous?: boolean;
  gift_name?: string;
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
/**
 * i18next normally interpolates these variables. Community proposals are
 * user-authored, though, and some of them arrive with a slightly different
 * interpolation configuration or literal braces. Keep a small defensive
 * pass so notifications never display `{{actor}}` to the user.
 */
export function interpolateNotification(text: string, params: NotificationParams): string {
  const values: Record<string, string> = {
    actor: params.actor ?? "",
    count: params.count == null ? "" : String(params.count),
    gift: params.gift_name ?? "",
  };
  return text.replace(/\{\{\s*(actor|count|gift)\s*\}\}/g, (_, key: string) => values[key]);
}

export function notificationTitle(notif: Notification, t: TFunction, actorName?: string): string {
  const rawParams = notif.params;
  const params: NotificationParams = {
    ...(rawParams && typeof rawParams === "object" ? rawParams : {}),
    // Legacy rows may have no structured actor, but the actor profile is
    // loaded separately by NotificationItem. Use it as a compatibility path.
    actor: (rawParams && typeof rawParams === "object" && typeof rawParams.actor === "string" && rawParams.actor.trim()
      ? rawParams.actor
      : actorName) ?? "",
  };
  const hasParams = Boolean(rawParams && typeof rawParams === "object" && Object.keys(rawParams).length > 0);
  if (hasParams) {
    let key: string | null = null;
    let values: Record<string, unknown> = {};
    switch (notif.type) {
      case "like":
        key = notif.related_post_id ? "notif.likePost" : "notif.likeThread";
        values = { actor: params.actor };
        break;
      case "reply":
        key = "notif.reply";
        values = { actor: params.actor };
        break;
      case "wall_post":
        key = "notif.wallPost";
        values = { actor: params.actor };
        break;
      case "wall_post_like":
        key = (params.count ?? 0) > 1 ? "notif.wallPostLikeGroup" : "notif.wallPostLike";
        values = { actor: params.actor, count: params.count };
        break;
      case "wall_comment":
        key = "notif.wallComment";
        values = { actor: params.actor };
        break;
      case "wall_comment_reply":
        key = "notif.wallCommentReply";
        values = { actor: params.actor };
        break;
      case "wall_repost":
        key = "notif.wallRepost";
        values = { actor: params.actor };
        break;
      case "friend_request":
        key = "notif.friendRequest";
        values = { actor: params.actor };
        break;
      case "friend_accepted":
        key = "notif.friendAccepted";
        values = { actor: params.actor };
        break;
      case "gift_received":
        key = params.anonymous ? "notif.giftReceivedAnonymous" : "notif.giftReceived";
        values = { actor: params.actor, gift: params.gift_name };
        break;
    }
    if (key) return interpolateNotification(t(key, values), params);
  }

  // Older rows and hand-created test/dev rows can still contain a template in
  // `title` without a params JSONB payload. Never expose the braces literally.
  return interpolateNotification(notif.title || "", params);
}
