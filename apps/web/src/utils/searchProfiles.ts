import { api } from "@/integrations/api/compat";

export interface ProfileSearchResult {
  id: string;
  username: string;
  account_number?: number;
  post_count?: number;
  thread_count?: number;
  wall_post_count?: number;
  avatar_url?: string | null;
  color?: string;
}

// Shared cache for user search results (used by the textarea mentions and the rich editor)
const searchCache = new Map<string, ProfileSearchResult[]>();

/**
 * Search profiles by username / account number / UUID, sorted so exact account
 * number matches win for numeric queries. Results are cached per query.
 * (Logic extracted from the old UserMentions.searchUsers so the textarea
 * mentions and the Tiptap mention suggester share one implementation.)
 */
export const searchProfiles = async (query: string): Promise<ProfileSearchResult[]> => {
  if (searchCache.has(query)) {
    return searchCache.get(query)!;
  }

  try {
    let queryBuilder = api
      .from("profiles")
      .select("id, username, account_number, post_count, thread_count, wall_post_count, avatar_url")
      .not("username", "is", null)
      .limit(10);

    if (query.length > 0) {
      // If query looks like a number, prioritize exact account_number match
      if (/^\d+$/.test(query)) {
        const accountNum = parseInt(query, 10);
        queryBuilder = queryBuilder.or(`account_number.eq.${accountNum},username.ilike.%${query}%`);
      } else {
        const conditions: string[] = [`username.ilike.%${query}%`];
        // If query looks like UUID, search by id
        if (query.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          conditions.push(`id.eq.${query}`);
        }
        queryBuilder = queryBuilder.or(conditions.join(","));
      }
    }

    const { data, error } = await queryBuilder;

    if (error) {
      console.error("Error searching users:", error);
      searchCache.set(query, []);
      return [];
    }

    const users: ProfileSearchResult[] = (data || []).map(
      (user: { id: string; username: string; account_number?: number; post_count?: number; thread_count?: number; wall_post_count?: number; avatar_url?: string | null }) => ({
        id: user.id,
        username: user.username,
        account_number: user.account_number,
        post_count: user.post_count || 0,
        thread_count: user.thread_count || 0,
        wall_post_count: user.wall_post_count || 0,
        avatar_url: user.avatar_url ?? null,
        color: "",
      })
    );

    if (/^\d+$/.test(query)) {
      const accountNum = parseInt(query, 10);
      users.sort((a, b) => {
        const aExact = a.account_number === accountNum ? 1 : 0;
        const bExact = b.account_number === accountNum ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        return a.username.localeCompare(b.username);
      });
    } else {
      users.sort((a, b) => a.username.localeCompare(b.username));
    }

    searchCache.set(query, users);
    return users;
  } catch (error) {
    console.error("Error searching users:", error);
    searchCache.set(query, []);
    return [];
  }
};
