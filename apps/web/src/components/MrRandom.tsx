import { useEffect, useState } from "react";
import { Hash, MessageCircle, MessageSquare, StickyNote, User } from "lucide-react";

import { apiClient } from "@/integrations/api/client";
import { PrefetchLink } from "@/components/PrefetchLink";
import { Spotlight } from "@/components/Spotlight";

interface RandomItem {
  type: "thread" | "wall_post" | "profile" | "wall_comment" | "gomosub";
  id: string;
  label: string;
  sublabel?: string;
  board_slug?: string;
  is_gomosub?: boolean;
  wall_user_id?: string;
  post_id?: string;
  username?: string;
  avatar_url?: string | null;
}

const hrefFor = (item: RandomItem): string => {
  switch (item.type) {
    case "thread":
      return item.is_gomosub && item.board_slug
        ? `/g/${item.board_slug}/thread/${item.id}`
        : `/thread/${item.id}`;
    case "wall_post":
      return `/profile/${item.wall_user_id}/wall/${item.id}`;
    case "wall_comment":
      return `/profile/${item.wall_user_id}/wall/${item.post_id}`;
    case "profile":
      return `/profile/${item.id}`;
    case "gomosub":
      return `/g/${item.board_slug}`;
    default:
      return "/";
  }
};

const ICON_BY_TYPE = {
  thread: MessageSquare,
  wall_post: StickyNote,
  wall_comment: MessageCircle,
  profile: User,
  gomosub: Hash,
} as const;

/**
 * «Mr. рандомность» — a sidebar block of random public content: a thread, a
 * wall post, a profile, a wall comment, a g-sub. Everything is served by
 * GET /api/v1/random (already public), so the block works for guests too.
 */
export const MrRandom = () => {
  const [items, setItems] = useState<RandomItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiClient.request<RandomItem[]>("/api/v1/random?limit=6");
        if (cancelled) return;
        setItems((resp.data as RandomItem[]) ?? []);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="overflow-clip rounded-[var(--card-radius)] border border-border/70 bg-surface">
      <h3 className="px-3 pt-3 text-[13px] font-semibold text-muted-foreground sm:px-4 sm:pt-4">
        Mr. рандомность
      </h3>
      <div className="p-2 sm:p-2.5">
        {items === null ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2.5 px-2.5 py-2">
              <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
              <span className="flex-1 space-y-1.5">
                <span className="block h-3.5 w-2/3 animate-pulse rounded bg-muted" />
                <span className="block h-3 w-1/3 animate-pulse rounded bg-muted" />
              </span>
            </div>
          ))
        ) : items.length === 0 ? (
          <p className="px-2.5 py-1.5 text-[13px] text-muted-foreground">Пока нечего показать</p>
        ) : (
          items.map((item) => {
            const Icon = ICON_BY_TYPE[item.type] ?? Hash;
            return (
              <Spotlight key={`${item.type}-${item.id}`} className="block">
                <PrefetchLink
                  to={hrefFor(item)}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-muted/60"
                >
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                    <Icon className="h-4 w-4 text-primary" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold leading-5 text-primary">
                      {item.label}
                    </span>
                    {item.sublabel && (
                      <span className="block truncate text-[13px] leading-5 text-muted-foreground">
                        {item.sublabel}
                      </span>
                    )}
                  </span>
                </PrefetchLink>
              </Spotlight>
            );
          })
        )}
      </div>
    </div>
  );
};
