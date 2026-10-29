export type CategoryLike = {
  id: string;
  name: string;
  sort_order: number;
};

export type GroupableChannel<T extends { id: string; sort_order: number; category_id?: string | null; category?: string | null }> = T;

export type ChannelGroup<T> = {
  /** Group key: `cat:<id>` for structured categories, `legacy:<name>` for the
   * old free-text bucket, `""` for uncategorized. */
  key: string;
  /** Display header; empty for uncategorized. */
  label: string;
  channels: T[];
};

/**
 * Discord-like channel grouping: uncategorized channels first, then
 * structured categories in sort_order, then legacy free-text buckets (kept
 * for channels created before categories existed). Channels keep their
 * sort_order inside each group.
 */
export const groupChannels = <
  T extends { id: string; sort_order: number; category_id?: string | null; category?: string | null },
>(
  channels: T[],
  categories: CategoryLike[],
): ChannelGroup<T>[] => {
  const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order);
  const byId = new Map(sortedCats.map((c) => [c.id, c]));
  const uncategorized: T[] = [];
  const perCat = new Map<string, T[]>();
  const legacy = new Map<string, T[]>();

  for (const ch of [...channels].sort((a, b) => a.sort_order - b.sort_order)) {
    if (ch.category_id && byId.has(ch.category_id)) {
      const list = perCat.get(ch.category_id) ?? [];
      list.push(ch);
      perCat.set(ch.category_id, list);
    } else if ((ch.category || "").trim()) {
      const name = (ch.category as string).trim();
      const list = legacy.get(name) ?? [];
      list.push(ch);
      legacy.set(name, list);
    } else {
      uncategorized.push(ch);
    }
  }

  const groups: ChannelGroup<T>[] = [];
  if (uncategorized.length) groups.push({ key: "", label: "", channels: uncategorized });
  for (const c of sortedCats) {
    groups.push({ key: `cat:${c.id}`, label: c.name, channels: perCat.get(c.id) ?? [] });
  }
  for (const [name, chs] of legacy) {
    groups.push({ key: `legacy:${name}`, label: name, channels: chs });
  }
  return groups;
};
