import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { MessageCircle, ThumbsUp } from "lucide-react";

import { UserAvatar } from "@/components/UserAvatar";
import { UserBadge } from "@/components/UserBadge";
import { FavoriteButton } from "@/components/FavoriteButton";
import { formatShortRelativeTime } from "@/utils/relativeTimeShort";
import { toFeedThread, type ThreadApiRow } from "@/utils/threadFeedItem";

/** Latest reply of a thread (right column + hover preview). */
export interface ThreadLastPost {
  user_id: string | null;
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
  currentUserId: string | null;
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
  currentUserId,
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
          const lastAt = last?.created_at || thread.created_at;
          const isNsfw = Boolean(thread.section?.is_nsfw);
          const lastUserId = last ? last.user_id : thread.user_id;
          const lastUsername = last?.username || thread.profiles?.username || "Аноним";
          const lastAvatar = last ? last.avatar_url : thread.profiles?.avatar_url;

          return (
            <div
              key={thread.id}
              onMouseEnter={(event) => showPreview(row, event.currentTarget)}
              onMouseLeave={hidePreview}
              onFocus={(event) => showPreview(row, event.currentTarget)}
              onBlur={hidePreview}
              className="group relative flex items-start gap-3 border-b border-border/50 px-3 py-3 transition-colors last:border-b-0 hover:bg-muted/40 focus-within:bg-muted/40 sm:px-4"
            >
              {/* Stretched link: the row opens the thread. The author links in
                  the content sit above it, so a nickname click goes to the
                  profile — an <a> nested in an <a> would be invalid. */}
              <Link
                to={threadPath(row)}
                aria-label={thread.title || "Открыть тему"}
                className="absolute inset-0 z-0 focus-visible:outline-none"
              />

              <div className="pointer-events-none relative z-10 min-w-0 flex-1">
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
                  <UserBadge
                    userId={thread.user_id}
                    username={thread.profiles?.username || "Аноним"}
                    displayName={thread.profiles?.display_name}
                    emojiId={thread.profiles?.nickname_emoji_id}
                    isAnonymous={thread.profiles?.is_anonymous}
                    className="pointer-events-auto max-w-[12rem] text-foreground"
                  />
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

              <div className="relative z-10 hidden w-[230px] shrink-0 items-center justify-end gap-2 text-right sm:flex">
                {/* Bookmark: a reserved slot that fades in on hover, like the
                    feed card's corner action — no layout shift, and always on
                    for touch devices. */}
                {currentUserId && (
                  <div className="pointer-events-none self-end translate-y-1.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 motion-reduce:transition-none">
                    <FavoriteButton itemType="thread" itemId={thread.id} />
                  </div>
                )}
                <div className="pointer-events-none min-w-0">
                  <UserBadge
                    userId={lastUserId}
                    username={lastUsername}
                    displayName={last ? undefined : thread.profiles?.display_name}
                    emojiId={last ? undefined : thread.profiles?.nickname_emoji_id}
                    isAnonymous={last ? false : thread.profiles?.is_anonymous}
                    className="pointer-events-auto block max-w-full overflow-hidden text-foreground"
                  />
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
                  alt={lastUsername}
                />
              </div>
            </div>
          );
        })}
      </div>

      {preview && (
        // eslint-disable-next-line @typescript-eslint/no-use-before-define -- hoisted renderer, defined below for readability
        <ThreadHoverPreview row={preview.row} rect={preview.rect} />
      )}
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

  // Open upward, above the row itself. Anchoring by `bottom` (instead of `top`)
  // keeps the card glued just over the row's top edge whatever its height is;
  // when there is no room above, it drops below instead.
  const gap = 8;
  const estimatedHeight = 240;
  const left = Math.min(
    Math.max(PREVIEW_MARGIN, rect.left),
    Math.max(PREVIEW_MARGIN, window.innerWidth - PREVIEW_WIDTH - PREVIEW_MARGIN),
  );
  let top: number | null = null;
  let bottom: number | null = null;
  if (rect.top >= estimatedHeight + PREVIEW_MARGIN) {
    bottom = window.innerHeight - rect.top + gap;
  } else {
    top = Math.min(rect.bottom + gap, window.innerHeight - estimatedHeight - PREVIEW_MARGIN);
  }

  return createPortal(
    <div
      role="tooltip"
      style={{
        left,
        width: PREVIEW_WIDTH,
        ...(top != null ? { top } : { bottom: bottom ?? 0 }),
      }}
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
