import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LayoutGrid, List } from "lucide-react";

import { CompactThreadList, type ThreadLastPost } from "@/components/CompactThreadList";
import { FeedThreadCard } from "@/components/FeedThreadCard";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { PentagramLoader } from "@/components/PentagramLoader";
import { ThreadFeedSkeleton } from "@/components/skeletons/ContentSkeletons";
import type { SectionWithSubsections, ThreadSubsection } from "@/hooks/useThreadSections";
import { useLoadingBarStore } from "@/stores/loadingBarStore";
import { fetchThreadLikesBatch, toFeedThread, type ThreadApiRow } from "@/utils/threadFeedItem";

const PAGE_SIZE = 20;

/** «Компактно» (dense forum list) vs «Лента» (the card feed). Cosmetic, so it
 *  lives in localStorage rather than on the backend. */
type SectionView = "compact" | "cards";
const VIEW_KEY = "gomo6:section-view";

const readView = (): SectionView => {
  try {
    return localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "compact";
  } catch {
    return "compact";
  }
};

interface DisplayedSection {
  section: SectionWithSubsections;
  subsection: ThreadSubsection | null;
  rows: ThreadApiRow[];
  likes: Map<string, { count: number; isLiked: boolean }>;
  lastPosts: Map<string, ThreadLastPost>;
}

/** Latest reply per thread (right column of the compact list). One batch call. */
const fetchLatestPosts = async (ids: string[]): Promise<Map<string, ThreadLastPost>> => {
  const map = new Map<string, ThreadLastPost>();
  if (ids.length === 0) return map;
  try {
    const res = await fetch(`/api/v1/posts?thread_id=in.(${ids.join(",")})&latest=true`);
    if (!res.ok) return map;
    const json = await res.json();
    ((json.data || []) as Array<{
      thread_id: string;
      user_id: string | null;
      username: string | null;
      avatar_url: string | null;
      created_at: string;
    }>).forEach((post) => {
      map.set(post.thread_id, {
        user_id: post.user_id,
        username: post.username,
        avatar_url: post.avatar_url,
        created_at: post.created_at,
      });
    });
  } catch {
    // Best-effort — rows simply fall back to the thread author + creation date.
  }
  return map;
};

/**
 * Last loaded page per section, kept across mounts so returning from the feed
 * (or another section) shows the previous list instantly instead of a
 * skeleton — then revalidates in the background.
 */
const sectionCache = new Map<string, DisplayedSection>();

const cacheKey = (sectionId: string, subsectionId?: string | null) =>
  `${sectionId}:${subsectionId ?? ""}`;

const fetchPage = async (
  section: SectionWithSubsections,
  subsection: ThreadSubsection | null,
  offset: number,
): Promise<ThreadApiRow[]> => {
  const params = new URLSearchParams();
  params.set("section_id", `eq.${section.id}`);
  if (subsection) params.set("subsection_id", `eq.${subsection.id}`);
  params.set("order", "updated_at.desc");
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  const res = await fetch(`/api/v1/threads?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.data || []) as ThreadApiRow[];
};

interface SectionThreadsProps {
  section: SectionWithSubsections;
  subsection?: ThreadSubsection | null;
  currentUserId: string | null;
  currentUsername: string;
  currentUserColor?: string;
  /** Fired once the target's list is on screen (from cache or after a fetch),
   *  so the parent can swap away from the previously shown view. */
  onReady?: () => void;
}

/**
 * Threads of one раздел (or подраздел), shown in place of the unified feed when
 * a sidebar section is picked.
 *
 * Stale-while-revalidate: when the target changes the previously loaded list
 * stays on screen (with the header's loading line as the only cue) until the
 * new page arrives, so switching never flashes a skeleton over content the
 * reader is already looking at.
 */
export const SectionThreads = ({
  section,
  subsection,
  currentUserId,
  currentUsername,
  currentUserColor,
  onReady,
}: SectionThreadsProps) => {
  const targetKey = cacheKey(section.id, subsection?.id);
  const [displayed, setDisplayed] = useState<DisplayedSection | null>(
    () => sectionCache.get(targetKey) ?? null,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [galleryItems, setGalleryItems] = useState<LightboxItem[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [view, setView] = useState<SectionView>(readView);
  const offsetRef = useRef(0);

  const changeView = useCallback((next: SectionView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // ignore (private mode / quota)
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let finished = false;
    const { begin, end } = useLoadingBarStore.getState();
    const finish = () => {
      if (finished) return;
      finished = true;
      end();
    };
    begin();

    (async () => {
      try {
        const rows = await fetchPage(section, subsection ?? null, 0);
        const ids = rows.map((row) => row.id);
        const [likes, lastPosts] = await Promise.all([
          fetchThreadLikesBatch(ids, currentUserId),
          fetchLatestPosts(ids),
        ]);
        if (cancelled) return;
        const next: DisplayedSection = {
          section,
          subsection: subsection ?? null,
          rows,
          likes,
          lastPosts,
        };
        sectionCache.set(targetKey, next);
        setDisplayed(next);
        offsetRef.current = rows.length;
        setHasMore(rows.length === PAGE_SIZE);
      } catch (error) {
        if (cancelled) return;
        console.error("Error loading section threads:", error);
        // Keep whatever was already shown; only seed an empty list if there is
        // nothing at all (a first visit to this section).
        if (!sectionCache.has(targetKey)) {
          const next: DisplayedSection = {
            section,
            subsection: subsection ?? null,
            rows: [],
            likes: new Map(),
            lastPosts: new Map(),
          };
          sectionCache.set(targetKey, next);
          setDisplayed(next);
        }
        setHasMore(false);
      } finally {
        finish();
      }
    })();

    return () => {
      cancelled = true;
      finish();
    };
    // `subsection` is derived from the (stable) sections list; the key covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, currentUserId]);

  // Tell the parent as soon as the target's list is displayed (cache hit or a
  // fresh fetch) so it can reveal this view and drop the previous one.
  useEffect(() => {
    if (!onReady || !displayed) return;
    if (cacheKey(displayed.section.id, displayed.subsection?.id) === targetKey) {
      onReady();
    }
  }, [displayed, targetKey, onReady]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !displayed) return;
    if (displayed.section.id !== section.id) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(section, subsection ?? null, offsetRef.current);
      const ids = page.map((row) => row.id);
      const [moreLikes, moreLast] = await Promise.all([
        fetchThreadLikesBatch(ids, currentUserId),
        fetchLatestPosts(ids),
      ]);
      setDisplayed((prev) => {
        if (!prev) return prev;
        const likes = new Map(prev.likes);
        moreLikes.forEach((value, key) => likes.set(key, value));
        const lastPosts = new Map(prev.lastPosts);
        moreLast.forEach((value, key) => lastPosts.set(key, value));
        const next: DisplayedSection = {
          ...prev,
          rows: [...prev.rows, ...page],
          likes,
          lastPosts,
        };
        sectionCache.set(targetKey, next);
        return next;
      });
      offsetRef.current += page.length;
      setHasMore(page.length === PAGE_SIZE);
    } catch (error) {
      console.error("Error loading more section threads:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, displayed, section, subsection, currentUserId, targetKey]);

  const headSection = displayed?.section ?? section;
  const headSubsection = displayed ? displayed.subsection : subsection ?? null;
  const rows = displayed?.rows ?? [];
  const likes = displayed?.likes;
  // The shown list belongs to a previously picked target while the new one loads.
  const isStale = Boolean(displayed) && displayed!.section.id !== section.id;

  const loadMoreButton = !isStale && hasMore ? (
    <div className="flex justify-center pt-2">
      <button
        type="button"
        onClick={loadMore}
        disabled={loadingMore}
        className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface px-4 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted/60 disabled:opacity-60"
      >
        {loadingMore ? <PentagramLoader size="sm" /> : "Показать ещё"}
      </button>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold leading-tight">{headSection.name}</h2>
          {headSubsection && (
            <p className="truncate text-[13px] text-muted-foreground">{headSubsection.name}</p>
          )}
        </div>

        <div
          role="group"
          aria-label="Вид списка тем"
          className="flex shrink-0 items-center rounded-full border border-border/70 bg-surface p-0.5"
        >
          {/* eslint-disable-next-line @typescript-eslint/no-use-before-define -- small renderer, defined below for readability */}
          <ViewToggleButton
            active={view === "compact"}
            onClick={() => changeView("compact")}
            icon={<List className="h-3.5 w-3.5" />}
            label="Компактно"
          />
          {/* eslint-disable-next-line @typescript-eslint/no-use-before-define -- small renderer, defined below for readability */}
          <ViewToggleButton
            active={view === "cards"}
            onClick={() => changeView("cards")}
            icon={<LayoutGrid className="h-3.5 w-3.5" />}
            label="Лента"
          />
        </div>
      </div>

      {!displayed ? (
        <ThreadFeedSkeleton count={5} />
      ) : rows.length === 0 ? (
        <div className="rounded-[var(--card-radius)] border border-dashed border-border/70 bg-muted/20 py-12 text-center">
          <p className="text-lg font-medium">Здесь пока пусто</p>
          <p className="mt-2 text-sm text-muted-foreground">Стань первым — создай тему в этом разделе</p>
        </div>
      ) : view === "compact" ? (
        <div
          key={cacheKey(displayed.section.id, displayed.subsection?.id)}
          className="animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none"
        >
          <CompactThreadList
            rows={rows}
            likes={likes}
            lastPosts={displayed.lastPosts}
          />
          {loadMoreButton}
        </div>
      ) : (
        <div
          key={cacheKey(displayed.section.id, displayed.subsection?.id)}
          className="space-y-4 animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none"
        >
          {rows.map((row) => {
            const thread = toFeedThread(row);
            const like = likes?.get(thread.id);
            return (
              <FeedThreadCard
                key={thread.id}
                thread={thread}
                currentUserId={currentUserId}
                currentUsername={currentUsername}
                currentUserColor={currentUserColor}
                initialLikesCount={like?.count ?? 0}
                initialUserLiked={like?.isLiked ?? false}
                onImageClick={(items, idx) => {
                  setGalleryItems(items);
                  setGalleryIndex(idx);
                }}
              />
            );
          })}

          {loadMoreButton}
        </div>
      )}

      {galleryItems && (
        <Lightbox
          items={galleryItems}
          initialIndex={galleryIndex}
          onClose={() => setGalleryItems(null)}
        />
      )}
    </div>
  );
};

/** One option of the section view switcher (compact ↔ cards). */
const ViewToggleButton = ({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    aria-label={label}
    title={label}
    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${
      active
        ? "bg-primary text-primary-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    }`}
  >
    {icon}
    <span className="hidden sm:inline">{label}</span>
  </button>
);
