import { useEffect, useState } from "react";
import { Play } from "lucide-react";

import { apiClient } from "@/integrations/api/client";
import { PrefetchLink } from "@/components/PrefetchLink";
import { Spotlight } from "@/components/Spotlight";
import { storageUrl } from "@/utils/storage";
import {
  DEFAULT_MR_RANDOM_COUNT,
  MR_RANDOM_COUNT_EVENT,
  getMrRandomCount,
} from "@/lib/mrRandom";
import { entityParam, profileUrl, wallPostUrl } from "@/utils/entityUrl";

interface RandomItem {
  type: "thread" | "wall_post" | "profile" | "wall_comment" | "gomosub";
  id: string;
  public_id?: number | null;
  label: string;
  sublabel?: string;
  board_slug?: string;
  is_gomosub?: boolean;
  wall_user_id?: string;
  wall_user_public_id?: number | null;
  post_id?: string;
  post_public_id?: number | null;
  username?: string;
  avatar_url?: string | null;
  /** Small square on the right for a thread/post with media. */
  thumb_url?: string;
  media_kind?: "image" | "video";
}

const hrefFor = (item: RandomItem): string => {
  switch (item.type) {
    case "thread":
      return item.is_gomosub && item.board_slug
        ? `/g/${item.board_slug}/thread/${entityParam(item)}`
        : `/thread/${entityParam(item)}`;
    case "wall_post":
      return wallPostUrl(
        { id: item.wall_user_id, public_id: item.wall_user_public_id },
        item,
      );
    case "wall_comment":
      return wallPostUrl(
        { id: item.wall_user_id, public_id: item.wall_user_public_id },
        { id: item.post_id, public_id: item.post_public_id },
      );
    case "profile":
      return profileUrl(item);
    case "gomosub":
      return `/g/${item.board_slug}`;
    default:
      return "/";
  }
};

/**
 * «Mr. рандомность» — a sidebar block of random public content: a thread, a
 * wall post, a profile, a wall comment, a g-sub. Everything is served by
 * GET /api/v1/random (already public), so the block works for guests too.
 */
export const MrRandom = () => {
  const [items, setItems] = useState<RandomItem[] | null>(null);
  const [count, setCount] = useState<number>(() => getMrRandomCount());

  // React live to the Settings choice (localStorage + event).
  useEffect(() => {
    const onCount = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail;
      setCount(typeof detail?.count === "number" ? detail.count : getMrRandomCount());
    };
    window.addEventListener(MR_RANDOM_COUNT_EVENT, onCount);
    return () => window.removeEventListener(MR_RANDOM_COUNT_EVENT, onCount);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiClient.request<RandomItem[]>(`/api/v1/random?limit=${count}`);
        if (cancelled) return;
        setItems((resp.data as RandomItem[]) ?? []);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [count]);

  const skeletonRows = Math.min(Math.max(count, DEFAULT_MR_RANDOM_COUNT), 3);

  return (
    <div className="overflow-clip rounded-[var(--card-radius)] border border-border/70 bg-surface">
      <h3 className="px-3 pt-3 text-[13px] font-semibold text-muted-foreground sm:px-4 sm:pt-4">
        Mr. рандомность
      </h3>
      <div className="p-2 sm:p-2.5">
        {items === null ? (
          [0, 1, 2].slice(0, skeletonRows).map((i) => (
            <div key={i} className="flex items-center gap-2.5 px-2.5 py-2">
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
            return (
              <Spotlight key={`${item.type}-${item.id}`} className="block">
                <PrefetchLink
                  to={hrefFor(item)}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-muted/60"
                >
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
                  {item.media_kind && item.thumb_url ? (
                    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md border border-border/60">
                      <img
                        src={storageUrl("content", item.thumb_url) || item.thumb_url}
                        alt=""
                        aria-hidden="true"
                        className="h-full w-full object-cover"
                      />
                      {item.media_kind === "video" && (
                        <span className="absolute inset-0 grid place-items-center bg-black/30">
                          <Play className="h-3.5 w-3.5 fill-current text-white" aria-hidden="true" />
                        </span>
                      )}
                    </span>
                  ) : item.media_kind === "video" ? (
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border/60 bg-muted">
                      <Play className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    </span>
                  ) : null}
                </PrefetchLink>
              </Spotlight>
            );
          })
        )}
      </div>
    </div>
  );
};
