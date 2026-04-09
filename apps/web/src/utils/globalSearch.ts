import { supabase } from "@/integrations/api/client_simple";

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
};

export type SearchThread = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  board_id: string;
  boards: {
    slug: string;
    name: string;
    is_gomosub?: boolean | null;
  };
};

export type GlobalSearchResult = {
  users: SearchUser[];
  gomosubs: SearchGomoSub[];
  threads: SearchThread[];
};

const dedupeById = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
};

export const searchGlobal = async (
  query: string,
  limits?: { users?: number; gomosubs?: number; threads?: number }
): Promise<GlobalSearchResult> => {
  const term = query.trim();
  if (term.length < 2) {
    return { users: [], gomosubs: [], threads: [] };
  }

  const userLimit = limits?.users ?? 8;
  const gomosubLimit = limits?.gomosubs ?? 8;
  const threadLimit = limits?.threads ?? 20;
  const like = `%${term}%`;

  const [usersRes, gomosubsNameRes, gomosubsSlugRes, threadsByTitleRes, threadsByContentRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .ilike("username", like)
      .limit(userLimit),
    supabase
      .from("boards")
      .select("id, slug, name, description, cover_image_url")
      .eq("is_gomosub", true)
      .ilike("name", like)
      .limit(gomosubLimit),
    supabase
      .from("boards")
      .select("id, slug, name, description, cover_image_url")
      .eq("is_gomosub", true)
      .ilike("slug", like)
      .limit(gomosubLimit),
    supabase
      .from("threads")
      .select("id, title, content, created_at, updated_at, board_id, boards!inner(slug, name, is_gomosub)")
      .ilike("title", like)
      .order("updated_at", { ascending: false })
      .limit(threadLimit),
    supabase
      .from("threads")
      .select("id, title, content, created_at, updated_at, board_id, boards!inner(slug, name, is_gomosub)")
      .ilike("content", like)
      .order("updated_at", { ascending: false })
      .limit(threadLimit),
  ]);

  const users = dedupeById((usersRes.data ?? []) as SearchUser[]).slice(0, userLimit);
  const gomosubs = dedupeById(
    ([...(gomosubsNameRes.data ?? []), ...(gomosubsSlugRes.data ?? [])] as SearchGomoSub[])
  ).slice(0, gomosubLimit);
  const threads = dedupeById(
    ([...(threadsByTitleRes.data ?? []), ...(threadsByContentRes.data ?? [])] as SearchThread[])
  )
    .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at))
    .slice(0, threadLimit);

  return { users, gomosubs, threads };
};
