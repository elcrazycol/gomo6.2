import { describe, it, expect } from "vitest";
import { feedItemToThread, feedItemToWallPost, toFeedThread } from "./threadFeedItem";
import { entityParam, profileUrl, threadUrl, wallPostUrl } from "./entityUrl";

// These mappers are where the public numbers used to get lost: the API sent them
// (public_id on the item, user_public_id on the wall owner, public_id inside the
// author embed), but the feed/history/favorites item was copied into a card shape
// without them — so every card linked by UUID while the profile header (fed from
// /auth/me) was numeric. The assertions below check the LINKS, not the fields.

const threadRow = {
  id: "thread-uuid",
  public_id: 315,
  user_public_id: 10,
  title: "t",
  content: "c",
  image_url: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  user_id: "author-uuid",
  username: "alice",
};

describe("toFeedThread", () => {
  it("keeps the numbers so the card links by number", () => {
    const thread = toFeedThread(threadRow);
    expect(threadUrl(thread, { slug: "general", is_gomosub: false })).toBe("/general/thread/315");
    expect(profileUrl({ id: thread.user_id ?? "", public_id: thread.user_public_id })).toBe("/profile/10");
  });

  it("falls back to the UUID when the API sent no number", () => {
    const thread = toFeedThread({ ...threadRow, public_id: null, user_public_id: null });
    expect(threadUrl(thread)).toBe("/thread/thread-uuid");
    expect(profileUrl({ id: thread.user_id ?? "", public_id: thread.user_public_id })).toBe(
      "/profile/author-uuid",
    );
  });
});

describe("feedItemToThread", () => {
  const item = {
    item_type: "thread" as const,
    item_id: "thread-uuid",
    public_id: 315,
    user_public_id: 10,
    created_at: "2025-01-01T00:00:00Z",
    author_id: "author-uuid",
    author: { username: "alice", public_id: 10, is_anonymous: false },
  };

  it("carries the item number and the author number", () => {
    const thread = feedItemToThread(item);
    expect(entityParam(thread)).toBe("315");
    expect(thread.profiles?.public_id).toBe(10);
    expect(profileUrl({ id: thread.user_id ?? "", public_id: thread.profiles?.public_id })).toBe("/profile/10");
  });
});

describe("feedItemToWallPost", () => {
  const item = {
    item_type: "wall_post" as const,
    item_id: "post-uuid",
    public_id: 1337,
    user_public_id: 42,
    wall_user_id: "owner-uuid",
    author_id: "author-uuid",
    created_at: "2025-01-01T00:00:00Z",
    author: { username: "bob", public_id: 11, is_anonymous: false },
  };

  it("carries the post number and the wall owner number", () => {
    const post = feedItemToWallPost(item);
    expect(
      wallPostUrl({ id: post.user_id, public_id: post.user_public_id }, post),
    ).toBe("/profile/42/wall/1337");
    expect(post.author.public_id).toBe(11);
  });

  it("falls back to UUIDs when the numbers are missing", () => {
    const post = feedItemToWallPost({ ...item, public_id: null, user_public_id: null });
    expect(wallPostUrl({ id: post.user_id, public_id: post.user_public_id }, post)).toBe(
      "/profile/owner-uuid/wall/post-uuid",
    );
  });
});
