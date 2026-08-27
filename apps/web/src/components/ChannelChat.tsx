import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/integrations/api/client";
import { wsService } from "@/services/websocket";
import { Button } from "@/components/ui/button";
import { Loader2, Pencil, SendHorizontal, Trash2, X } from "lucide-react";
import { safeDate } from "@/utils/safeDate";
import { useDateLocale } from "@/i18n/dateLocale";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

// Discord-style text channel: a single live message stream inside one GomoSub
// channel. Deliberately minimal v1: history + send + realtime + edit/delete.
// Typing indicators, replies, attachments and unread counters are future work.

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

interface ChannelChatProps {
  channelId: string;
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

export function ChannelChat({ channelId, currentUserId, canPost = true, canDeleteOthers = false }: ChannelChatProps) {
  const dateLocale = useDateLocale();
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      // jsdom and some browsers without smooth-scroll support have no scrollTo.
      if (el && typeof el.scrollTo === "function") {
        try {
          el.scrollTo({ top: el.scrollHeight, behavior });
        } catch {
          el.scrollTop = el.scrollHeight;
        }
      } else if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }, []);

  // History load + realtime room subscription. Both are scoped to channelId:
  // switching channels tears down the old room before opening the next one,
  // so events of the previous channel never leak into the new timeline.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDenied(false);
    setMessages([]);
    setEditingId(null);
    stickToBottomRef.current = true;

    const room = `channel_${channelId}`;
    wsService.subscribe(room);

    const offNew = wsService.on("new_channel_message", (m) => {
      const data = m.data as Partial<ChannelMessage> & { id?: number };
      if (!data?.id || data.channel_id !== channelId || data.user_id == null) return;
      // Dedup inside the updater: several events can land in one tick, and
      // this keeps the check race-free against the optimistic REST append.
      setMessages((prev) => {
        if (prev.some((x) => x.id === data.id)) return prev;
        return [...prev, { ...data } as ChannelMessage];
      });
      scrollToBottom("smooth");
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

    (async () => {
      try {
        const r = await fetch(
          `/api/v1/gomosubchat/channels/${channelId}/messages?limit=50`,
          { credentials: "include" }
        );
        const d = await r.json().catch(() => null);
        if (cancelled) return;
        if (r.status === 403) {
          setDenied(true);
          return;
        }
        if (!r.ok || !d?.success) throw new Error(d?.error || "Не удалось загрузить историю");
        setMessages(d.data as ChannelMessage[]);
        scrollToBottom();
      } catch {
        if (!cancelled) setDenied(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      offNew();
      offEdited();
      offDeleted();
      wsService.unsubscribe(room);
    };
  }, [channelId, scrollToBottom]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const r = await fetch(`/api/v1/gomosubchat/channels/${channelId}/messages`, {
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
      stickToBottomRef.current = true;
      scrollToBottom("smooth");
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
      const r = await fetch(
        `/api/v1/gomosubchat/channels/${channelId}/messages/${editingId}`,
        {
          method: "PUT",
          credentials: "include",
          headers: authHeaders(true),
          body: JSON.stringify({ content }),
        }
      );
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
      const r = await fetch(
        `/api/v1/gomosubchat/channels/${channelId}/messages/${msg.id}`,
        { method: "DELETE", credentials: "include", headers: authHeaders() }
      );
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.success) throw new Error(d?.error || "Не удалось удалить сообщение");
      setMessages((prev) => prev.map((x) => (x.id === msg.id ? { ...x, content: "", deleted_at: new Date().toISOString() } : x)));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const canEdit = useCallback(
    (m: ChannelMessage) => Boolean(currentUserId) && m.user_id === currentUserId && !m.deleted_at,
    [currentUserId]
  );
  const canDelete = useCallback(
    (m: ChannelMessage) => !m.deleted_at && ((Boolean(currentUserId) && m.user_id === currentUserId) || canDeleteOthers),
    [currentUserId, canDeleteOthers]
  );

  const timeLabel = useMemo(
    () => (iso: string) => formatDistanceToNow(safeDate(iso), { locale: dateLocale, addSuffix: true }),
    [dateLocale]
  );

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (denied) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-8">
        <div className="text-center text-muted-foreground text-sm">
          Нет доступа к этому каналу.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border/60 bg-card overflow-hidden">
      {/* Message stream */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1"
        data-testid="channel-chat-messages"
      >
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-10">
            Пока тишина. Напишите первым!
          </div>
        )}
        {messages.map((m, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const grouped =
            !!prev &&
            prev.user_id === m.user_id &&
            safeDate(m.created_at).getTime() - safeDate(prev.created_at).getTime() < 5 * 60 * 1000;
          return (
            <div
              key={m.id}
              className={`group relative flex gap-2 ${grouped ? "py-0.5" : "pt-2 pb-0.5"} hover:bg-muted/30 rounded-md px-2`}
            >
              <div className="shrink-0 w-8">
                {!grouped &&
                  (m.avatar_url ? (
                    <img
                      src={m.avatar_url || undefined}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover border border-border"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center text-xs font-semibold text-muted-foreground">
                      {(m.username || "?").slice(0, 1).toUpperCase()}
                    </div>
                  ))}
              </div>
              <div className="min-w-0 flex-1">
                {!grouped && (
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold truncate">{m.username}</span>
                    <span className="text-[11px] text-muted-foreground">{timeLabel(m.created_at)}</span>
                  </div>
                )}
                {m.deleted_at ? (
                  <div className="text-sm italic text-muted-foreground">Сообщение удалено</div>
                ) : editingId === m.id ? (
                  <div className="flex items-center gap-1 mt-0.5">
                    <input
                      value={editDraft}
                      maxLength={MAX_CONTENT_LENGTH}
                      data-autofocus="true"
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
                    <button
                      onClick={handleEditSave}
                      className="p-1 text-muted-foreground hover:text-primary"
                      title="Сохранить"
                    >
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
                  <div className="text-sm whitespace-pre-wrap break-words">
                    {m.content}
                    {m.edited_at && <span className="ml-1 text-[10px] text-muted-foreground">(изменено)</span>}
                  </div>
                )}
              </div>
              {!m.deleted_at && editingId !== m.id && (
                <div className="absolute right-2 top-0 hidden group-hover:flex items-center gap-0.5 bg-card/90 border border-border rounded-md shadow-sm">
                  {canEdit(m) && (
                    <button
                      onClick={() => {
                        setEditingId(m.id);
                        setEditDraft(m.content);
                        // Focus the editor on the next frame — eslint a11y rule
                        // forbids the autoFocus prop.
                        requestAnimationFrame(() => {
                          const el = scrollRef.current?.querySelector('[data-autofocus="true"]') as HTMLInputElement | null;
                          el?.focus();
                        });
                      }}
                      className="p-1.5 text-muted-foreground hover:text-primary"
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
          );
        })}
      </div>

      {/* Composer */}
      <div className="border-t border-border/60 p-2 shrink-0">
        {currentUserId ? (
          canPost ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
            >
              <input
                value={draft}
                maxLength={MAX_CONTENT_LENGTH}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Написать сообщение…"
                className="flex-1 h-9 bg-background border border-border rounded-lg px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button type="submit" size="icon" className="h-9 w-9" disabled={sending || !draft.trim()}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4" />}
              </Button>
            </form>
          ) : (
            <div className="text-center text-xs text-muted-foreground py-1.5">
              Вступите в гомосаб, чтобы писать в канал
            </div>
          )
        ) : (
          <div className="text-center text-xs text-muted-foreground py-1.5">Войдите, чтобы писать в канал</div>
        )}
      </div>
    </div>
  );
}

export default ChannelChat;
