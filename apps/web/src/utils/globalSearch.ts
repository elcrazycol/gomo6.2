import { apiClient } from "@/integrations/api/client";

export type SearchUser = {
  id: string;
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
  thread_title: string;
  board_id: string;
  board_slug: string;
  board_name: string;
  board_is_gomosub?: boolean | null;
  username?: string | null;
  avatar_url?: string | null;
};

export type GlobalSearchResult = {
  users: SearchUser[];
  boards: SearchGomoSub[];
  threads: SearchThread[];
  posts: SearchPost[];
};

// Normalise thread results to the shape expected by the UI (with boards object)
const normaliseThread = (t: Record<string, unknown>): SearchThread => ({
  id: t.id as string,
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
  limits?: { users?: number; boards?: number; threads?: number; posts?: number }
): Promise<GlobalSearchResult> => {
  const term = query.trim();
  if (term.length < 2) {
    return { users: [], boards: [], threads: [], posts: [] };
  }

  try {
    const response = await apiClient.rawRequest(
      `/api/v1/search?q=${encodeURIComponent(term)}`
    );

    if (!response.success || !response.data) {
      return { users: [], boards: [], threads: [], posts: [] };
    }

    const data = response.data as {
      users?: SearchUser[];
      boards?: SearchGomoSub[];
      threads?: Record<string, unknown>[];
      posts?: SearchPost[];
    };

    const userLimit = limits?.users ?? 8;
    const boardLimit = limits?.boards ?? 8;
    const threadLimit = limits?.threads ?? 20;
    const postLimit = limits?.posts ?? 10;

    const threads = (data.threads ?? []).map(normaliseThread);

    return {
      users: (data.users ?? []).slice(0, userLimit),
      boards: (data.boards ?? []).slice(0, boardLimit),
      threads: threads.slice(0, threadLimit),
      posts: (data.posts ?? []).slice(0, postLimit),
    };
  } catch (e) {
    console.error("Search failed:", e);
    return { users: [], boards: [], threads: [], posts: [] };
  }
};
