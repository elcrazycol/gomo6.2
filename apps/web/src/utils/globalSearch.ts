import { apiClient } from "@/integrations/api/client";

export type SearchUser = {
  id: string;
  public_id?: number | null;
  username: string;
  avatar_url?: string | null;
};

export type SearchGomoSub = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  cover_image_url?: string | null;
  is_gomosub?: boolean | null;
};

export type SearchThread = {
  id: string;
  public_id?: number | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  board_id: string;
  board_slug: string;
  board_name: string;
  board_is_gomosub?: boolean | null;
};

export type SearchPost = {
  id: string;
  content: string;
  created_at: string;
  thread_id: string;
  /** The thread's public number — post hits link to the thread, not the post. */
  thread_public_id?: number | null;
  thread_title: string;
  board_id: string;
  board_slug: string;
  board_name: string;
  board_is_gomosub?: boolean | null;
  username?: string | null;
  avatar_url?: string | null;
};

export type SearchWallPost = {
  id: string;
  public_id?: number | null;
  title?: string | null;
  content: string;
  created_at: string;
  updated_at: string;
  author_id?: string | null;
  author_username?: string | null;
  wall_user_id?: string | null;
  wall_username?: string | null;
};

export type GlobalSearchResult = {
  users: SearchUser[];
  boards: SearchGomoSub[];
  threads: SearchThread[];
  posts: SearchPost[];
  wall_posts: SearchWallPost[];
};

// SearchFilters mirror the optional query parameters the engine-backed
// endpoint understands. All are additive: omitting them keeps the legacy
// "search everything" behaviour.
export type SearchFilters = {
  /** Restrict to a subset of users,boards,threads,posts. */
  types?: string[];
  /** Restrict threads/posts to an author (UUID or exact username). */
  author?: string;
  /** Only results created after: "24h" | "7d" | "30d" | "1y" or unix seconds. */
  since?: string;
  /** "recent" sorts by creation date; otherwise relevance. */
  sort?: "recent";
  /** Per-category cap (server clamps to 100). */
  limit?: number;
};

// Normalise thread results to the shape expected by the UI (with boards object)
const normaliseThread = (t: Record<string, unknown>): SearchThread => ({
  id: t.id as string,
  public_id: t.public_id as number | null | undefined,
  title: t.title as string,
  content: t.content as string,
  created_at: t.created_at as string,
  updated_at: t.updated_at as string,
  board_id: t.board_id as string,
  board_slug: t.board_slug as string,
  board_name: t.board_name as string,
  board_is_gomosub: t.board_is_gomosub as boolean | null | undefined,
});

export const searchGlobal = async (
  query: string,
  limits?: { users?: number; boards?: number; threads?: number; posts?: number; wall_posts?: number },
  filters?: SearchFilters
): Promise<GlobalSearchResult> => {
  const term = query.trim();
  if (term.length < 2) {
    return { users: [], boards: [], threads: [], posts: [], wall_posts: [] };
  }

  try {
    const params = new URLSearchParams({ q: term });
    if (filters?.types && filters.types.length > 0) params.set("type", filters.types.join(","));
    if (filters?.author && filters.author.trim()) params.set("author", filters.author.trim());
    if (filters?.since) params.set("since", filters.since);
    if (filters?.sort) params.set("sort", filters.sort);
    if (filters?.limit) params.set("limit", String(filters.limit));

    const response = await apiClient.rawRequest(`/api/v1/search?${params.toString()}`);

    if (!response.success || !response.data) {
      return { users: [], boards: [], threads: [], posts: [], wall_posts: [] };
    }

    const data = response.data as {
      users?: SearchUser[];
      boards?: SearchGomoSub[];
      threads?: Record<string, unknown>[];
      posts?: SearchPost[];
      wall_posts?: SearchWallPost[];
    };

    const userLimit = limits?.users ?? 8;
    const boardLimit = limits?.boards ?? 8;
    const threadLimit = limits?.threads ?? 20;
    const postLimit = limits?.posts ?? 10;
    const wallPostLimit = limits?.wall_posts ?? 10;

    const threads = (data.threads ?? []).map(normaliseThread);

    return {
      users: (data.users ?? []).slice(0, userLimit),
      boards: (data.boards ?? []).slice(0, boardLimit),
      threads: threads.slice(0, threadLimit),
      posts: (data.posts ?? []).slice(0, postLimit),
      wall_posts: (data.wall_posts ?? []).slice(0, wallPostLimit),
    };
  } catch (e) {
    console.error("Search failed:", e);
    return { users: [], boards: [], threads: [], posts: [], wall_posts: [] };
  }
};
