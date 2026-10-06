import { getCached } from "@/integrations/api/queryCache";
import { registerRouteData } from "@/lib/routeData";

export interface BoardRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  is_rules_board: boolean;
  is_gomosub?: boolean | null;
  visibility?: string | null;
  cover_image_url?: string | null;
  gomosub_avatar_url?: string | null;
  owner_id?: string | null;
  rules_markdown?: string | null;
  rules_updated_at?: string | null;
  gomosub_tags?: string[] | null;
}

export interface ChannelRow {
  id: string;
  board_id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  sort_order: number;
  is_private: boolean;
  kind?: "forum" | "text";
}

const BOARD_TTL_MS = 5 * 60 * 1000;
const BOARD_STALE_MS = 30 * 60 * 1000;

export const boardBySlugUrl = (slug: string): string => `/api/v1/boards/${slug}`;
export const boardChannelsUrl = (boardId: string): string =>
  `/api/v1/channels?board_id=eq.${boardId}&order=sort_order.asc`;

export const fetchBoardBySlug = async (slug: string): Promise<BoardRow | null> => {
  const res = await fetch(boardBySlugUrl(slug));
  const json = await res.json();
  return (json.data as BoardRow | undefined) ?? null;
};

export const fetchBoardChannels = async (boardId: string): Promise<ChannelRow[]> => {
  const res = await fetch(boardChannelsUrl(boardId));
  const json = await res.json();
  return (json.data || []) as ChannelRow[];
};

/** Board row through the shared URL cache (public board metadata). */
export const loadBoardBySlug = (slug: string): Promise<BoardRow | null> =>
  getCached(boardBySlugUrl(slug), () => fetchBoardBySlug(slug), {
    ttlMs: BOARD_TTL_MS,
    staleTtlMs: BOARD_STALE_MS,
  });

/**
 * The board's channel list, unfiltered. Private-channel permission filtering
 * stays in the page (it depends on the viewer); the cache only holds the raw
 * metadata, which is the same for everyone.
 */
export const loadBoardChannels = (boardId: string): Promise<ChannelRow[]> =>
  getCached(boardChannelsUrl(boardId), () => fetchBoardChannels(boardId), {
    ttlMs: BOARD_TTL_MS,
    staleTtlMs: BOARD_STALE_MS,
  });

export function registerBoardRouteData(): void {
  registerRouteData({
    id: "board",
    match: ["/g/:slug", "/g/:slug/c/:channelSlug"],
    warm: async ({ params }) => {
      const slug = params.slug;
      if (!slug) return;
      // `/g/:slug` also matches the static `/g/create` route; don't try to warm
      // a board that does not exist.
      if (slug === "create") return;
      const board = await loadBoardBySlug(slug);
      if (board?.is_gomosub) {
        await loadBoardChannels(board.id);
      }
    },
  });
}
