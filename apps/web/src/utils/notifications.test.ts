import { describe, it, expect } from "vitest";
import { notificationLink, isWallNotification } from "./notifications";
import type { Notification } from "@/integrations/api/client";

const base = {
  id: "n1",
  user_id: "me",
  type: "like",
  title: "t",
  message: "",
  is_read: false,
  created_at: "2025-01-01T00:00:00Z",
} satisfies Notification;

describe("notificationLink", () => {
  it("links wall events to the wall post page", () => {
    const n: Notification = {
      ...base,
      type: "wall_comment",
      related_wall_post_id: "post-1",
      related_wall_user_id: "wall-owner",
    };
    expect(notificationLink(n)).toBe("/profile/wall-owner/wall/post-1");
  });

  it("falls back to the recipient's own wall when wall owner is missing", () => {
    const n: Notification = {
      ...base,
      type: "wall_post",
      related_wall_post_id: "post-2",
      user_id: "me",
    };
    expect(notificationLink(n)).toBe("/profile/me/wall/post-2");
  });

  it("links friend events to the actor profile", () => {
    const n: Notification = { ...base, type: "friend_request", related_user_id: "alice" };
    expect(notificationLink(n)).toBe("/profile/alice");
  });

  it("links thread events via slug when provided", () => {
    const n: Notification = { ...base, type: "reply", related_thread_id: "t1" };
    expect(notificationLink(n, "b")).toBe("/b/thread/t1");
  });

  it("falls back to # for notifications with no target", () => {
    expect(notificationLink({ ...base, type: "achievement_unlock" })).toBe("#");
  });
});

describe("isWallNotification", () => {
  it("recognizes wall event types", () => {
    expect(isWallNotification("wall_post_like")).toBe(true);
    expect(isWallNotification("like")).toBe(false);
  });
});
