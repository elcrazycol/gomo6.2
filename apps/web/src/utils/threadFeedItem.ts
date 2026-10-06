import type { FeedThread } from "@/components/FeedThreadCard";
import { normalizeWallPostRecord, type WallPost } from "@/utils/wallNormalizers";

/**
 * One thread row from GET /api/v1/threads (the ThreadWithBoards shape: flat
 * author fields, `boards`, and optional `section`/`subsection`).
 */
export interface ThreadApiRow {
  id: string;
  /** Public number of the thread, for /thread/<n> links. */
  public_id?: number | null;
  /** Public number of the author, for /profile/<n> links. */
  user_public_id?: number | null;
  title: string | null;
  content: string | null;
  content_json?: unknown;
  image_url: string | null;
  image_urls?: string[] | null;
  attachments?: unknown;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  board_id?: string | null;
  post_count?: number | null;
  tags?: Record<string, string> | null;
  username?: string | null;
  display_name?: string | null;
  nickname_emoji_id?: string | null;
  avatar_url?: string | null;
  is_anonymous?: boolean | null;
  boards?: { slug: string; name: string; is_gomosub?: boolean } | null;
  section?: FeedThread["section"];
  subsection?: FeedThread["subsection"];
}

/** Map an /api/v1/threads row to the shape the feed card renders. */
export const toFeedThread = (row: ThreadApiRow): FeedThread => ({
  id: row.id,
  public_id: row.public_id,
  user_public_id: row.user_public_id,
  title: row.title || "",
  content: row.content || "",
  content_json: row.content_json,
  image_url: row.image_url ?? null,
  image_urls: row.image_urls ?? null,
  attachments: row.attachments,
  created_at: row.created_at,
  updated_at: row.updated_at,
  user_id: row.user_id,
  board_id: row.board_id ?? "",
  post_count: row.post_count ?? 0,
  tags: row.tags ?? undefined,
  profiles: {
    username: row.username || "Аноним",
    display_name: row.display_name ?? null,
    nickname_emoji_id: row.nickname_emoji_id ?? null,
    is_anonymous: Boolean(row.is_anonymous),
    avatar_url: row.avatar_url ?? null,
  },
  boards: row.boards ?? { slug: "", name: "", is_gomosub: false },
  section: row.section ?? null,
  subsection: row.subsection ?? null,
});

/**
 * The item shape shared by GET /api/v1/feed, /history and /favorites.
 *
 * Those three surfaces each used to carry their own copy of the mapping below,
 * and every copy silently dropped the public numbers — the cards then linked by
 * UUID while the API was sending numbers all along. All of them delegate here.
 */
export interface FeedShapedItem {
  item_type: "thread" | "wall_post";
  item_id: string;
  /** The item's own number (thread or wall post). */
  public_id?: number | null;
  /** The wall owner's number (wall posts only). */
  user_public_id?: number | null;
  score?: number;
  created_at: string;
  updated_at?: string | null;
  title?: string | null;
  content?: string | null;
  content_json?: unknown;
  image_url?: string | null;
  image_urls?: string[] | null;
  attachments?: unknown;
  tags?: Record<string, string> | null;
  post_count?: number | null;
  author_id?: string | null;
  author?: {
    username: string;
    public_id?: number | null;
    display_name?: string | null;
    nickname_emoji_id?: string | null;
    is_anonymous?: boolean;
    avatar_url?: string | null;
  } | null;
  board_id?: string | null;
  boards?: FeedThread["boards"] | null;
  section?: FeedThread["section"];
  subsection?: FeedThread["subsection"];
  wall_user_id?: string | null;
  likes_count?: number;
  comments_count?: number;
  reposts_count?: number;
  liked_by_viewer?: boolean;
  views_count?: number;
}

/** Map a feed/history/favorites item to the thread card's shape. */
export const feedItemToThread = (item: FeedShapedItem): FeedThread => ({
  id: item.item_id,
  public_id: item.public_id,
  // The author's number, NOT the wall owner's: on a feed item `user_public_id`
  // belongs to the wall post's owner, and a thread item has no wall owner — its
  // author number lives in the author embed. Reading only `user_public_id` here
  // sent every author link in the feed back to the UUID.
  user_public_id: item.user_public_id ?? item.author?.public_id ?? null,
  title: item.title || "",
  content: item.content || "",
  content_json: item.content_json,
  image_url: item.image_url ?? null,
  image_urls: item.image_urls ?? null,
  attachments: item.attachments,
  created_at: item.created_at,
  updated_at: item.updated_at || item.created_at,
  user_id: item.author_id ?? null,
  board_id: item.board_id ?? "",
  post_count: item.post_count ?? 0,
  tags: item.tags ?? undefined,
  profiles: item.author
    ? {
        username: item.author.username,
        public_id: item.author.public_id ?? null,
        display_name: item.author.display_name ?? null,
        nickname_emoji_id: item.author.nickname_emoji_id ?? null,
        is_anonymous: Boolean(item.author.is_anonymous),
        avatar_url: item.author.avatar_url ?? null,
      }
    : null,
  boards: item.boards ?? { slug: "", name: "", is_gomosub: false },
  section: item.section ?? null,
  subsection: item.subsection ?? null,
});

/** Map a feed/history/favorites item to the wall post card's shape. */
export const feedItemToWallPost = (item: FeedShapedItem): WallPost =>
  normalizeWallPostRecord({
    id: item.item_id,
    public_id: item.public_id,
    user_id: item.wall_user_id,
    user_public_id: item.user_public_id,
    author_id: item.author_id,
    title: item.title,
    content: item.content,
    content_json: item.content_json,
    image_url: item.image_url,
    attachments: item.attachments,
    created_at: item.created_at,
    updated_at: item.updated_at,
    likes_count: item.likes_count,
    comments_count: item.comments_count,
    reposts_count: item.reposts_count,
    liked_by_viewer: item.liked_by_viewer,
    views_count: item.views_count,
    author: item.author,
  } as unknown as Record<string, unknown>);

/** Batch-fetch per-viewer thread like state (one request for many threads). */
export const fetchThreadLikesBatch = async (
  ids: string[],
  currentUserId: string | null,
): Promise<Map<string, { count: number; isLiked: boolean }>> => {
  const map = new Map<string, { count: number; isLiked: boolean }>();
  if (ids.length === 0) return map;
  try {
    const res = await fetch(
      `/api/rpc/get_thread_likes_batch?thread_ids=${ids.join(",")}&user_uuid=${currentUserId ?? ""}`,
    );
    if (!res.ok) return map;
    const json = await res.json();
    ((json.data || []) as { thread_id: string; count: number; is_liked: boolean }[]).forEach((item) =>
      map.set(item.thread_id, { count: item.count, isLiked: item.is_liked }),
    );
  } catch {
    // Best-effort — cards simply start at 0 / not liked.
  }
  return map;
};
