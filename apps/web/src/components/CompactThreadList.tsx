import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { MessageCircle, ThumbsUp } from "lucide-react";

import { UserAvatar } from "@/components/UserAvatar";
import { formatShortRelativeTime } from "@/utils/relativeTimeShort";
import { toFeedThread, type ThreadApiRow } from "@/utils/threadFeedItem";

/** Latest reply of a thread (right column + hover preview). */
export interface ThreadLastPost {
  username: string | null;
  avatar_url?: string | null;
  created_at: string;
}

const PREVIEW_WIDTH = 340;
const PREVIEW_DELAY_MS = 200;
const PREVIEW_MARGIN = 12;

const threadPath = (row: ThreadApiRow): string => {
  const slug = row.boards?.slug || "";
  const prefix = row.boards?.is_gomosub ? "/g" : "";
  return slug ? `${prefix}/${slug}/thread/${row.id}` : `/thread/${row.id}`;
};

interface CompactThreadListProps {
  rows: ThreadApiRow[];
  likes?: Map<string, { count: number; isLiked: boolean }>;
  /** threadId → latest reply, when the thread has any. */
  lastPosts?: Map<string, ThreadLastPost>;
}

/**
 * Dense forum-style thread list: one line per topic with author/date/replies/
 * likes on the left and the last poster + activity time on the right. Hovering
 * a row (desktop) pops a mini preview of the first post. This is the «компактно»
 * variant of the section list; the card variant stays in SectionThreads.
 */
export const CompactThreadList = ({
  rows,
  likes,
  lastPosts,
}: CompactThreadListProps) => {
  const [preview, setPreview] = useState<{
    row: ThreadApiRow;
    rect: DOMRect;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showPreview = useCallback(
    (row: ThreadApiRow, el: HTMLElement) => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        setPreview({ row, rect: el.getBoundingClientRect() });
      }, PREVIEW_DELAY_MS);
    },
    [clearTimer],
  );

  const hidePreview = useCallback(() => {
    clearTimer();
    setPreview(null);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <>
      <div className="overflow-hidden rounded-[var(--card-radius)] border border-border/60 bg-surface/40">
        {rows.map((row) => {
          const thread = toFeedThread(row);
          const like = likes?.get(thread.id);
          const last = lastPosts?.get(thread.id);
          const lastName = last?.username || thread.profiles?.username || "Аноним";
          const lastAvatar = last ? last.avatar_url : thread.profiles?.avatar_url;
          const lastAt = last?.created_at || thread.created_at;
          const isNsfw = Boolean(thread.section?.is_nsfw);

          return (
            <Link
              key={thread.id}
              to={threadPath(row)}
              onMouseEnter={(event) => showPreview(row, event.currentTarget)}
              onMouseLeave={hidePreview}
              onFocus={(event) => showPreview(row, event.currentTarget)}
              onBlur={hidePreview}
              className="group flex items-start gap-3 border-b border-border/50 px-3 py-3 transition-colors last:border-b-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:px-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <h3 className="truncate text-[15px] font-semibold leading-6 text-foreground transition-colors group-hover:text-primary">
                    {thread.title || "Без названия"}
                  </h3>
                  {isNsfw && (
                    <span className="shrink-0 rounded-full border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-destructive">
                      18+
                    </span>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
                  <span className="max-w-[12rem] truncate text-foreground/75">
                    {thread.profiles?.username || "Аноним"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={thread.created_at}>
                    {formatShortRelativeTime(thread.created_at)}
                  </time>
                  <span className="inline-flex items-center gap-1" title="Ответы">
                    <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    {thread.post_count}
                  </span>
                  <span className="inline-flex items-center gap-1" title="Лайки">
                    <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                    {like?.count ?? 0}
                  </span>
                </div>
              </div>

              <div className="hidden w-[190px] shrink-0 items-center justify-end gap-2 text-right sm:flex">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-foreground/80">{lastName}</div>
                  <time
                    dateTime={lastAt}
                    className="block text-[12px] text-muted-foreground"
                  >
                    {formatShortRelativeTime(lastAt)}
                  </time>
                </div>
                <UserAvatar
                  src={lastAvatar}
                  userId={last ? undefined : thread.user_id}
                  className="h-8 w-8 shrink-0"
                  alt={lastName}
                />
              </div>
            </Link>
          );
        })}
      </div>

      {preview && <ThreadHoverPreview row={preview.row} rect={preview.rect} />}
    </>
  );
};

/** Floating mini preview of a thread's first post, anchored to its row. */
const ThreadHoverPreview = ({
  row,
  rect,
}: {
  row: ThreadApiRow;
  rect: DOMRect;
}) => {
  const thread = toFeedThread(row);
  const content = (thread.content || "").trim();

  // Right of the row when there's room, then left, otherwise drop below it —
  // never cover the row the preview describes.
  const spaceRight = window.innerWidth - rect.right - PREVIEW_MARGIN;
  const spaceLeft = rect.left - PREVIEW_MARGIN;
  let left: number;
  let top = rect.top;
  if (spaceRight >= PREVIEW_WIDTH) {
    left = rect.right + PREVIEW_MARGIN;
  } else if (spaceLeft >= PREVIEW_WIDTH) {
    left = rect.left - PREVIEW_WIDTH - PREVIEW_MARGIN;
  } else {
    left = rect.left;
    top = rect.bottom + 8;
  }
  left = Math.min(
    Math.max(PREVIEW_MARGIN, left),
    Math.max(PREVIEW_MARGIN, window.innerWidth - PREVIEW_WIDTH - PREVIEW_MARGIN),
  );
  top = Math.min(
    Math.max(PREVIEW_MARGIN, top),
    Math.max(PREVIEW_MARGIN, window.innerHeight - 220),
  );

  return createPortal(
    <div
      role="tooltip"
      style={{ left, top, width: PREVIEW_WIDTH }}
      className="pointer-events-none fixed z-50 animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none"
    >
      <div className="rounded-[var(--card-radius)] border border-border/70 bg-card p-3.5 shadow-xl shadow-black/20">
        <div className="flex items-start gap-3">
          <UserAvatar
            src={thread.profiles?.avatar_url}
            userId={thread.user_id}
            className="h-9 w-9 shrink-0"
            alt={thread.profiles?.username || "Аноним"}
          />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold leading-5 text-foreground">
              {thread.title || "Без названия"}
            </div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              <span className="text-foreground/75">{thread.profiles?.username || "Аноним"}</span>
              {", "}
              {formatShortRelativeTime(thread.created_at)}
            </div>
          </div>
        </div>

        {content && (
          <>
            <div className="my-3 h-px bg-border/60" />
            <p className="line-clamp-4 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground/90">
              {content}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};
