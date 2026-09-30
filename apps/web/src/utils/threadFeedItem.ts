import type { FeedThread } from "@/components/FeedThreadCard";

/**
 * One thread row from GET /api/v1/threads (the ThreadWithBoards shape: flat
 * author fields, `boards`, and optional `section`/`subsection`).
 */
export interface ThreadApiRow {
  id: string;
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
