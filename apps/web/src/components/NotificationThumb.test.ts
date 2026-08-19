import { describe, it, expect } from "vitest";
import { notificationThumbTarget } from "@/utils/notifications";
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

describe("notificationThumbTarget", () => {
  it("previews the wall post for wall events", () => {
    const n: Notification = { ...base, type: "wall_post_like", related_wall_post_id: "wp1" };
    expect(notificationThumbTarget(n)).toEqual({ kind: "wall", id: "wp1" });
  });

  it("previews the thread for replies", () => {
    const n: Notification = { ...base, type: "reply", related_post_id: "p1", related_thread_id: "t1" };
    expect(notificationThumbTarget(n)).toEqual({ kind: "thread", id: "t1" });
  });

  it("previews the liked post for likes", () => {
    const n: Notification = { ...base, type: "like", related_post_id: "p1", related_thread_id: "t1" };
    expect(notificationThumbTarget(n)).toEqual({ kind: "post", id: "p1" });
  });

  it("previews the thread for thread-only likes", () => {
    const n: Notification = { ...base, type: "like", related_thread_id: "t1" };
    expect(notificationThumbTarget(n)).toEqual({ kind: "thread", id: "t1" });
  });

  it("returns null when there is no preview target", () => {
    expect(notificationThumbTarget({ ...base, type: "friend_request", related_user_id: "u1" })).toBeNull();
  });
});
