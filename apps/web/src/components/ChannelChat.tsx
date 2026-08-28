import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { apiClient } from "@/integrations/api/client";
import { wsService } from "@/services/websocket";
import { Button } from "@/components/ui/button";
import { ChevronDown, Hash, Loader2, Pencil, SendHorizontal, Trash2, X } from "lucide-react";
import { safeDate } from "@/utils/safeDate";
import { useDateLocale } from "@/i18n/dateLocale";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

// Discord-style text channel: a full-bleed virtualized message stream under a
// channel header rendered by Board. The virtualizer renders only the visible
// rows (like the messenger's MessageList), history is fetched in pages on
// scroll-to-top, and the view stays pinned to the bottom while the user is
// there. Deliberately leaner than the messenger: no read receipts, no
// scroll-restore across sessions, no keyboard lift.

export interface ChannelMessage {
  id: number;
  channel_id: string;
  user_id: string;
  username: string;
  avatar_url?: string | null;
  content: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
}

const MAX_CONTENT_LENGTH = 4000;

// ── Virtual list geometry (kept in sync with the row markup below) ─────────
const HISTORY_HEADER_HEIGHT = 28; // "Начало канала" / "Загружаем историю…" strip
const BOTTOM_GAP_HEIGHT = 16;     // breathing room under the last message
const AT_BOTTOM_SLACK = 12;       // px from the bottom still treated as "at bottom"
const TOP_LOAD_ZONE = 300;        // px from the top that arms the history loader
const OVERSCAN = 10;              // rows rendered beyond the viewport
const GROUP_WINDOW_MS = 5 * 60 * 1000; // same-author messages within this are compact
const LOAD_THROTTLE_MS = 500;     // min gap between history page loads

interface ChannelChatProps {
  channelId: string;
  /** Used for the Discord-style "Написать в #name" composer placeholder and welcome block */
  channelName?: string;
  currentUserId?: string | null;
  /** false renders a join-first notice instead of the composer */
  canPost?: boolean;
  /** board owner / can_delete_threads members may remove other people's messages */
  canDeleteOthers?: boolean;
}

function authHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = apiClient.getToken();
  const csrf = apiClient.getCSRFToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

const HISTORY_URL = (channelId: string) =>
  `/api/v1/gomosubchat/channels/${channelId}/messages`;

/** Rough pre-measurement height — the virtualizer corrects it with the real
 *  measured row once it scrolls into view. Full-width rows fit ~70 chars. */
function estimateRowHeight(m: ChannelMessage | undefined, prev: ChannelMessage | null): number {
  if (!m) return 58;
  const grouped =
    !!prev &&
    prev.user_id === m.user_id &&
    safeDate(m.created_at).getTime() - safeDate(prev.created_at).getTime() < GROUP_WINDOW_MS;
  const base = grouped ? 30 : 58; // avatar/name header only on ungrouped rows
  if (m.deleted_at) return base;
  const lines = Math.max(1, Math.ceil(m.content.length / 70));
  return base + (lines - 1) * 26;
}

function isGroupedWith(prev: ChannelMessage | null, m: ChannelMessage): boolean {
  return (
    !!prev &&
    prev.user_id === m.user_id &&
    safeDate(m.created_at).getTime() - safeDate(prev.created_at).getTime() < GROUP_WINDOW_MS
  );
}

export function ChannelChat({
  channelId,
  channelName,
  currentUserId,
  canPost = true,
  canDeleteOthers = false,
}: ChannelChatProps) {
  const dateLocale = useDateLocale();
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // True while pinned to the bottom: appends clamp to the real bottom, and the
  // "N new" pill counts messages only while the user is scrolled up.
  const stickToBottomRef = useRef(true);
  const messagesRef = useRef<ChannelMessage[]>([]);
  messagesRef.current = messages;
  const hasMoreRef = useRef(false);
  hasMoreRef.current = hasMore;
  const loadingMoreRef = useRef(false);
  const lastLoadAtRef = useRef(0);
  const prevLastIdRef = useRef<number | null>(null);
  const userDraggingRef = useRef(false);
  // The message at the top of the viewport when a history page was requested;
  // the layout effect below re-freezes it after the prepend so the view does
  // not jump.
  const pendingAnchorRef = useRef<{ id: number; offset: number } | null>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (index) => estimateRowHeight(messages[index], messages[index - 1] ?? null),
    overscan: OVERSCAN,
    getItemKey: (index) => messages[index].id,
  });

  const timeLabel = useMemo(
    () => (iso: string) => formatDistanceToNow(safeDate(iso), { locale: dateLocale, addSuffix: true }),
    [dateLocale]
  );
  // Discord shows HH:MM in the left gutter when hovering a grouped row.
  const clockTime = useMemo(
    () => (iso: string) => format(safeDate(iso), "HH:mm", { locale: dateLocale }),
    [dateLocale]
  );

  // ── History page (scroll-to-top) ─────────────────────────────────────────
  const loadOlder = useCallback(async () => {
    if (loadingMoreRef.current) return;
    const list = messagesRef.current;
    if (list.length === 0) return;
    const oldest = list[0];

    // Freeze the top-most visible message before the prepend.
    let anchor = { id: oldest.id, offset: 0 };
    const el = scrollerRef.current;
    if (el) {
      for (const item of virtualizer.getVirtualItems()) {
        const m = list[item.index];
        if (m && item.end > el.scrollTop) {
          anchor = { id: m.id, offset: Math.max(0, el.scrollTop - item.start) };
          break;
        }
      }
    }

    loadingMoreRef.current = true;
    setLoadingOlder(true);
    try {
      const r = await fetch(
        `${HISTORY_URL(channelId)}?before=${oldest.id}&limit=50`,
        { credentials: "include" }
      );
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.success) return;
      const older = d.data as ChannelMessage[];
      if (older.length === 0) {
        setHasMore(false);
        return;
      }
      const existing = new Set(list.map((m) => m.id));
      const fresh = older.filter((m) => !existing.has(m.id));
      if (fresh.length === 0) {
        setHasMore(false);
        return;
      }
      pendingAnchorRef.current = anchor;
      setMessages((prev) => [...fresh, ...prev]);
      if (older.length < 50) setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      setLoadingOlder(false);
    }
  }, [channelId, virtualizer]);

  // ── Mount: history + room subscription + realtime handlers ──────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDenied(false);
    setMessages([]);
    setEditingId(null);
    setHasMore(false);
    stickToBottomRef.current = true;
    setIsAtBottom(true);
    setNewMessageCount(0);

    const room = `channel_${channelId}`;
    wsService.subscribe(room);

    const loadFirstPage = async () => {
      try {
        const r = await fetch(`${HISTORY_URL(channelId)}?limit=50`, { credentials: "include" });
        const d = await r.json().catch(() => null);
        if (cancelled) return;
        if (r.status === 403) {
          setDenied(true);
          return;
        }
        if (!r.ok || !d?.success) throw new Error(d?.error || "Не удалось загрузить историю");
        const page = d.data as ChannelMessage[];
        setMessages(page);
        setHasMore(page.length === 50);
      } catch {
        if (!cancelled) setDenied(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadFirstPage();

    // Reconnect: the socket re-subscribes rooms on its own; refetch the tail
    // so messages that arrived during the drop are not silently missing.
    const refetchTail = async () => {
      const list = messagesRef.current;
      if (list.length === 0) return; // initial connect — loadFirstPage owns that
      try {
        const r = await fetch(`${HISTORY_URL(channelId)}?limit=50`, { credentials: "include" });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d?.success) return;
        const latest = d.data as ChannelMessage[];
        setMessages((prev) => {
          const lastId = prev.length > 0 ? prev[prev.length - 1].id : 0;
          const existing = new Set(prev.map((m) => m.id));
          const fresh = latest.filter((m) => !existing.has(m.id) && m.id > lastId);
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      } catch {
        // Non-fatal: the next page load or reload heals the list.
      }
    };
    const offConnected = wsService.on("connected", () => {
      void refetchTail();
    });

    const offNew = wsService.on("new_channel_message", (m) => {
      const data = m.data as Partial<ChannelMessage> & { id?: number };
      if (!data?.id || data.channel_id !== channelId || data.user_id == null) return;
      // Dedup inside the updater: several events can land in one tick, and
      // this keeps the check race-free against the optimistic REST append.
      setMessages((prev) => {
        if (prev.some((x) => x.id === data.id)) return prev;
        return [...prev, { ...data } as ChannelMessage];
      });
    });

    const offEdited = wsService.on("channel_message_edited", (m) => {
      const data = m.data as Partial<ChannelMessage>;
      if (data?.channel_id !== channelId || typeof data?.id !== "number") return;
      setMessages((prev) =>
        prev.map((x) =>
          x.id === data.id && !x.deleted_at
            ? { ...x, content: data.content ?? x.content, edited_at: data.edited_at ?? new Date().toISOString() }
            : x
        )
      );
    });

    const offDeleted = wsService.on("channel_message_deleted", (m) => {
      const data = m.data as Partial<ChannelMessage>;
      if (data?.channel_id !== channelId || typeof data?.id !== "number") return;
      setMessages((prev) =>
        prev.map((x) => (x.id === data.id ? { ...x, content: "", deleted_at: new Date().toISOString() } : x))
      );
    });

    return () => {
      cancelled = true;
      offConnected();
      offNew();
      offEdited();
      offDeleted();
      wsService.unsubscribe(room);
    };
  }, [channelId]);

  // ── Scroll: at-bottom tracking + history loader ─────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_SLACK;
    if (atBottom !== stickToBottomRef.current) {
      stickToBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
      if (atBottom) setNewMessageCount(0);
    }

    const now = Date.now();
    if (
      el.scrollTop <= TOP_LOAD_ZONE &&
      hasMoreRef.current &&
      !loadingMoreRef.current &&
      !userDraggingRef.current &&
      now - lastLoadAtRef.current > LOAD_THROTTLE_MS
    ) {
      lastLoadAtRef.current = now;
      void loadOlder();
    }
  }, [loadOlder]);

  // ── Position stabilization: bottom pin / prepend anchor ─────────────────
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || virtualizer.isScrolling) return;

    const pending = pendingAnchorRef.current;
    if (pending) {
      const idx = messages.findIndex((m) => m.id === pending.id);
      if (idx >= 0) {
        const res = virtualizer.getOffsetForIndex(idx);
        if (res) {
          const target = res[0] - pending.offset;
          if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
        }
      }
      pendingAnchorRef.current = null;
      return;
    }

    if (stickToBottomRef.current) {
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      if (Math.abs(el.scrollTop - maxScrollTop) > 1) el.scrollTop = maxScrollTop;
    }
  }, [totalSize, messages, virtualizer, virtualizer.isScrolling]);

  // ── "N new messages" counter while scrolled up ──────────────────────────
  useEffect(() => {
    if (messages.length === 0) {
      prevLastIdRef.current = null;
      return;
    }
    const lastId = messages[messages.length - 1].id;
    const prevLast = prevLastIdRef.current;
    if (prevLast !== null && lastId !== prevLast) {
      const idx = messages.findIndex((m) => m.id === prevLast);
      if (idx >= 0 && !stickToBottomRef.current) {
        const appended = messages.slice(idx + 1);
        const incoming = appended.filter((m) => m.user_id !== currentUserId).length;
        if (incoming > 0) setNewMessageCount((c) => c + incoming);
      }
    }
    prevLastIdRef.current = lastId;
  }, [messages, currentUserId]);

  const scrollToBottom = useCallback(() => {
    stickToBottomRef.current = true;
    setIsAtBottom(true);
    setNewMessageCount(0);
    const el = scrollerRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      try {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        return;
      } catch {
        // fall through
      }
    }
    el.scrollTop = el.scrollHeight;
  }, []);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const r = await fetch(HISTORY_URL(channelId), {
        method: "POST",
        credentials: "include",
        headers: authHeaders(true),
        body: JSON.stringify({ content }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.success) throw new Error(d?.error || "Сообщение не отправлено");
      const msg = d.data as ChannelMessage;
      // The WS event carries the same message; append optimistically here and
      // let the dedup in the event handler swallow the duplicate.
      setMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]));
      setDraft("");
      scrollToBottom();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка отправки");
    } finally {
      setSending(false);
    }
  };

  const handleEditSave = async () => {
    if (editingId == null) return;
    const content = editDraft.trim();
    if (!content) return;
    try {
      const r = await fetch(`${HISTORY_URL(channelId)}/${editingId}`, {
        method: "PUT",
        credentials: "include",
        headers: authHeaders(true),
        body: JSON.stringify({ content }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.success) throw new Error(d?.error || "Не удалось изменить сообщение");
      const msg = d.data as ChannelMessage;
      setMessages((prev) =>
        prev.map((x) => (x.id === editingId ? { ...x, content: msg.content, edited_at: msg.edited_at ?? null } : x))
      );
      setEditingId(null);
      setEditDraft("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка изменения");
    }
  };

  const handleDelete = async (msg: ChannelMessage) => {
    try {
      const r = await fetch(`${HISTORY_URL(channelId)}/${msg.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: authHeaders(),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.success) throw new Error(d?.error || "Не удалось удалить сообщение");
      setMessages((prev) =>
        prev.map((x) => (x.id === msg.id ? { ...x, content: "", deleted_at: new Date().toISOString() } : x))
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const canEdit = (m: ChannelMessage) => Boolean(currentUserId) && m.user_id === currentUserId && !m.deleted_at;
  const canDelete = (m: ChannelMessage) =>
    !m.deleted_at && ((Boolean(currentUserId) && m.user_id === currentUserId) || canDeleteOthers);

  const virtualItems = virtualizer.getVirtualItems();
  const contentHeight = HISTORY_HEADER_HEIGHT + totalSize + BOTTOM_GAP_HEIGHT;
  const displayName = channelName || "канал";

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-background">
      {/* Message stream */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        onPointerDown={() => {
          userDraggingRef.current = true;
        }}
        onPointerUp={() => {
          userDraggingRef.current = false;
        }}
        onPointerCancel={() => {
          userDraggingRef.current = false;
        }}
        data-testid="channel-chat-messages"
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        role="log"
        aria-label="Сообщения канала"
        aria-live="polite"
      >
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : denied ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 pt-24">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
              <Hash className="w-7 h-7 text-muted-foreground" />
            </div>
            <div className="text-center text-muted-foreground text-sm">Нет доступа к этому каналу.</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="px-4 sm:px-5 pt-14 pb-6 max-w-2xl">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Hash className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-bold">Добро пожаловать в #{displayName}!</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Это начало канала. Здесь пока тихо — напишите первым.
            </p>
          </div>
        ) : (
          <div style={{ height: contentHeight, position: "relative" }}>
            <div
              className="flex items-center justify-center gap-3 text-[11px] text-muted-foreground/70"
              style={{ position: "absolute", top: 0, left: 0, right: 0, height: HISTORY_HEADER_HEIGHT }}
            >
              <span className="h-px flex-1 max-w-24 bg-border/60" />
              {loadingOlder ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Загружаем историю…
                </span>
              ) : hasMore ? (
                <span>Скрольте вверх, чтобы загрузить ещё</span>
              ) : (
                <span>Начало канала</span>
              )}
              <span className="h-px flex-1 max-w-24 bg-border/60" />
            </div>

            {virtualItems.map((row) => {
              const m = messages[row.index];
              if (!m) return null;
              const prev = row.index > 0 ? messages[row.index - 1] : null;
              const grouped = isGroupedWith(prev, m);
              return (
                <div
                  key={row.key}
                  data-index={row.index}
                  data-message-id={m.id}
                  ref={virtualizer.measureElement}
                  style={{ position: "absolute", top: HISTORY_HEADER_HEIGHT + row.start, left: 0, right: 0 }}
                >
                  <div
                    className={`group relative flex gap-3 px-4 sm:px-5 hover:bg-muted/40 transition-colors ${
                      grouped ? "py-0.5" : "pt-2.5 pb-0.5"
                    }`}
                  >
                    <div className="shrink-0 w-10 flex justify-center">
                      {!grouped ? (
                        m.avatar_url ? (
                          <img
                            src={m.avatar_url}
                            alt=""
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
                            {(m.username || "?").slice(0, 1).toUpperCase()}
                          </div>
                        )
                      ) : (
                        <span
                          aria-hidden="true"
                          className="hidden group-hover:block pt-1.5 text-[10px] leading-none text-muted-foreground/50"
                        >
                          {clockTime(m.created_at)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pb-0.5">
                      {!grouped && (
                        <div className="flex items-baseline gap-2">
                          <span className="text-[15px] font-medium leading-tight hover:underline cursor-pointer">
                            {m.username}
                          </span>
                          <span className="text-[11px] text-muted-foreground/60">
                            {timeLabel(m.created_at)}
                          </span>
                        </div>
                      )}
                      {m.deleted_at ? (
                        <div className="text-[15px] italic text-muted-foreground/70">Сообщение удалено</div>
                      ) : editingId === m.id ? (
                        <div className="flex items-center gap-1 mt-0.5">
                          <input
                            value={editDraft}
                            maxLength={MAX_CONTENT_LENGTH}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleEditSave();
                              if (e.key === "Escape") {
                                setEditingId(null);
                                setEditDraft("");
                              }
                            }}
                            className="flex-1 h-7 bg-background border border-border rounded-md px-2 text-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          />
                          <button onClick={handleEditSave} className="p-1 text-muted-foreground hover:text-primary" title="Сохранить">
                            <SendHorizontal className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditDraft("");
                            }}
                            className="p-1 text-muted-foreground hover:text-destructive"
                            title="Отмена"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                          {m.content}
                          {m.edited_at && <span className="ml-1 text-[10px] text-muted-foreground/50">(изменено)</span>}
                        </div>
                      )}
                    </div>
                    {!m.deleted_at && editingId !== m.id && (
                      <div className="absolute -top-3 right-4 hidden group-hover:flex items-center rounded-lg border border-border/60 bg-card shadow-md">
                        {canEdit(m) && (
                          <button
                            onClick={() => {
                              setEditingId(m.id);
                              setEditDraft(m.content);
                              requestAnimationFrame(() => {
                                const el = scrollerRef.current?.querySelector('[data-autofocus="true"]') as HTMLInputElement | null;
                                el?.focus();
                              });
                            }}
                            className="p-1.5 text-muted-foreground hover:text-foreground"
                            title="Изменить"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete(m) && (
                          <button
                            onClick={() => handleDelete(m)}
                            className="p-1.5 text-muted-foreground hover:text-destructive"
                            title="Удалить"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            <div aria-hidden="true" style={{ position: "absolute", top: HISTORY_HEADER_HEIGHT + totalSize, left: 0, right: 0, height: BOTTOM_GAP_HEIGHT }} />
          </div>
        )}
      </div>

      {/* Jump to the newest while scrolled up */}
      {!isAtBottom && messages.length > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute right-4 bottom-[76px] h-8 w-8 rounded-full border border-border bg-card shadow-md flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
          aria-label={
            newMessageCount > 0
              ? `Вниз (${newMessageCount} ${newMessageCount === 1 ? "новое" : "новых"} сообщени${newMessageCount === 1 ? "е" : "й"})`
              : "Вниз"
          }
        >
          <ChevronDown className="w-4 h-4" />
          {newMessageCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
              {newMessageCount > 99 ? "99+" : newMessageCount}
            </span>
          )}
        </button>
      )}

      {/* Composer — Discord-style pill, full width of the chat area. Hidden
          entirely when the channel is inaccessible. */}
      {!denied && (
      <div className="shrink-0 px-4 sm:px-5 pb-3 pt-1">
        {currentUserId ? (
          canPost ? (
            <form
              className="flex items-center gap-1 rounded-2xl border border-border/40 bg-muted/50 focus-within:border-ring/50 transition-colors px-2 h-11"
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
            >
              <input
                value={draft}
                maxLength={MAX_CONTENT_LENGTH}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Написать в #${displayName}…`}
                className="flex-1 h-full min-w-0 bg-transparent px-2 text-[15px] placeholder:text-muted-foreground/60 focus:outline-none"
              />
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-40"
                disabled={sending || !draft.trim()}
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4" />}
              </Button>
            </form>
          ) : (
            <div className="rounded-2xl border border-border/40 bg-muted/40 text-center text-xs text-muted-foreground py-2.5">
              Вступите в гомосаб, чтобы писать в канал
            </div>
          )
        ) : (
          <div className="rounded-2xl border border-border/40 bg-muted/40 text-center text-xs text-muted-foreground py-2.5">
            Войдите, чтобы писать в канал
          </div>
        )}
      </div>
      )}
    </div>
  );
}

export default ChannelChat;
