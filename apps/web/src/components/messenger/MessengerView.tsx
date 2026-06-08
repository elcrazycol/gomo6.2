import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useSearchParams, type NavigateOptions } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { api } from "@/integrations/api/compat";
import { useWebSocket } from "@/contexts/WebSocketContext";
import { MessengerErrorBoundary } from "./ErrorBoundary";
import { ConversationList } from "./ConversationList";
import { ChatView } from "./ChatView";
import type {
  ProfileSummary,
  ConversationRow,
  ConversationRecord,
  ConversationMemberRecord,
  ChatMessageRecord,
  ChatReceiptRecord,
  ConversationView,
  MessageView,
  PinnedMessageInfo,
} from "./types";

// ─── Pure helpers (outside component, no closures) ──────────────────────────

/** Merge server messages into existing state without losing in-flight data.
 *  Preserves: (a) pending optimistic inserts not yet confirmed by server,
 *  (b) messages added via WebSocket during the fetch window that aren't
 *  yet in the server response (DB replication lag). */
const mergeServerMessages = (prev: MessageView[], server: MessageView[]): MessageView[] => {
  const serverMsgIds = new Set(server.map((m) => m.id));
  const serverCids = new Set(server.map((m) => m.client_message_id).filter(Boolean));

  const pending = prev.filter((m) => m.localStatus === "pending");
  const stillPending = pending.filter((m) => !serverCids.has(m.client_message_id));

  // Keep non-pending messages that server doesn't know about yet (WS race)
  const unknown = prev.filter(
    (m) => m.localStatus !== "pending" && !m.id.startsWith("local-") && !serverMsgIds.has(m.id),
  );

  return [...stillPending, ...unknown, ...server].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
  );
};
const loadConversationsFromApi = async (userId: string): Promise<ConversationView[]> => {
  const { data: memberships, error: mErr } = await api
    .from("chat_conversation_members" as never)
    .select("conversation_id,unread_count_cache,last_read_at")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });

  if (mErr || !memberships) return [];

  const rows = memberships as ConversationRow[];
  const ids = rows.map((r) => r.conversation_id);
  if (ids.length === 0) return [];

  const [cRes, mRes, pRes] = await Promise.all([
    api.from("chat_conversations" as never).select("id,last_message_at,updated_at,pinned_message_id").in("id", ids),
    api.from("chat_conversation_members" as never).select("conversation_id,user_id").in("conversation_id", ids),
    api.from("profiles").select("id,username,avatar_url,account_number,is_online,last_seen_at"),
  ]);

  const convRows = (cRes.data || []) as ConversationRecord[];
  const memberRows = (mRes.data || []) as ConversationMemberRecord[];
  const allProfiles = (pRes.data || []) as ProfileSummary[];

  const otherIds = Array.from(new Set(memberRows.filter((r) => r.user_id !== userId).map((r) => r.user_id)));
  const profileMap = new Map(allProfiles.filter((p) => otherIds.includes(p.id)).map((r) => [r.id, r]));

  return rows
    .map((m) => {
      const other = memberRows.find((r) => r.conversation_id === m.conversation_id && r.user_id !== userId);
      if (!other) return null;
      const profile = profileMap.get(other.user_id);
      if (!profile) return null;
      const conv = convRows.find((c) => c.id === m.conversation_id);
      if (!conv) return null;
      return {
        id: m.conversation_id,
        unreadCount: m.unread_count_cache ?? 0,
        lastReadAt: m.last_read_at,
        lastMessageAt: conv.last_message_at,
        pinnedMessageId: conv.pinned_message_id ?? null,
        otherUser: profile,
      } satisfies ConversationView;
    })
    .filter((v): v is ConversationView => v !== null)
    .sort((a, b) => {
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    });
};

const loadMessagesFromApi = async (
  conversationId: string,
  meId: string,
  otherUserId: string,
  signal?: AbortSignal,
): Promise<MessageView[]> => {
  // Build URL manually — simple & predictable
  const params = new URLSearchParams({
    select: "id,conversation_id,sender_user_id,client_message_id,sent_at,content_encrypted,content",
    conversation_id: `eq.${conversationId}`,
    order: "sent_at.desc",
    limit: "50",
  });
  const url = `/api/v1/chat_messages?${params}`;

  const token = localStorage.getItem("auth_token");
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const rows = (json.data ?? []) as ChatMessageRecord[];
  rows.reverse(); // oldest first

  // Fetch receipts — build single in.(id1,id2,...) param
  if (rows.length === 0) return [];
  const rParams = new URLSearchParams({ select: "message_id,user_id,delivered_at,read_at" });
  rParams.append("message_id", `in.(${rows.map((m) => m.id).join(",")})`);
  const rRes = await fetch(`/api/v1/chat_receipts?${rParams}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const rJson = await rRes.json();
  const receipts = (rJson.data ?? []) as ChatReceiptRecord[];

  return rows.map((m) => {
    const peer = receipts.find((r) => r.message_id === m.id && r.user_id === otherUserId) ?? null;
    return {
      ...m,
      plainText: m.content || "[Сообщение]",
      peerDeliveredAt: peer?.delivered_at ?? null,
      peerReadAt: peer?.read_at ?? null,
    } satisfies MessageView;
  });
};

// ─── Component ──────────────────────────────────────────────────────────────

export const MessengerView = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const ws = useWebSocket();

  // ── Simple state ──────────────────────────────────────────────────────
  const [me, setMe] = useState<ProfileSummary | null>(null);
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Loading flags
  const [initLoading, setInitLoading] = useState(true);  // sidebar skeleton
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [startingChat, setStartingChat] = useState(false);

  // Pinned message
  const [pinnedInfo, setPinnedInfo] = useState<PinnedMessageInfo>(null);

  // Abort controller for message loads
  const abortRef = useRef<AbortController | null>(null);
  const lastLoadedConvId = useRef<string | null>(null);

  // Refs for DOM
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const msgScrollRef = useRef<HTMLDivElement | null>(null);
  const msgsRef = useRef<MessageView[]>([]);

  // Mobile
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── Derived ────────────────────────────────────────────────────────────
  const conversation = conversations.find((c) => c.id === selectedId) ?? null;
  const showMobileChat = Boolean(conversation) && (!isMobile || !sidebarOpen);

  // ── URL helpers ────────────────────────────────────────────────────────
  const updateUrl = useCallback(
    (convId: string | null, userId: string | null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (convId) next.set("conversation", convId);
        else next.delete("conversation");
        if (userId) next.set("user", userId);
        else next.delete("user");
        return next;
      }, { replace: true } as NavigateOptions);
    },
    [setSearchParams],
  );

  // ── Bootstrap: load profile + conversations ───────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await api.auth.getUser();
        if (cancelled) return;

        // No user at all — check if it's a network error (token exists but backend unreachable)
        if (!user) {
          if (localStorage.getItem("auth_token")) {
            // Has token but couldn't fetch user — network error, stay in messenger
            setError("Сервер временно недоступен. Попробуем переподключиться...");
            setInitLoading(false);
            return;
          }
          // No token at all — real auth failure, redirect to login
          navigate("/auth");
          return;
        }

        // Build profile from /auth/me response (sufficient for messenger)
        setMe({
          id: user.id,
          username: user.username,
          avatar_url: user.avatar_url ?? null,
          account_number: null,
          is_online: false,
          last_seen_at: null,
        });

        const views = await loadConversationsFromApi(user.id);
        if (cancelled) return;
        setConversations(views);

        // Pick initial conversation
        const targetUser = searchParams.get("user");
        const reqConv = searchParams.get("conversation");
        const pick = targetUser
          ? views.find((v) => v.otherUser.id === targetUser)
          : reqConv
            ? views.find((v) => v.id === reqConv)
            : views[0];
        if (pick) setSelectedId(pick.id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Ошибка загрузки");
      } finally {
        if (!cancelled) setInitLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mobile detection ───────────────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 980px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // ── Load messages when conversation changes ────────────────────────────
  useEffect(() => {
    if (!me || !selectedId) {
      setMessages([]);
      lastLoadedConvId.current = null;
      return;
    }
    const conv = conversations.find((c) => c.id === selectedId);
    if (!conv) return;

    // Skip reload if same conversation (metadata-only update: unread, pin, lastMessageAt)
    if (lastLoadedConvId.current === selectedId) return;
    lastLoadedConvId.current = selectedId;

    // Abort any in-flight load from previous conversation
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setMsgsLoading(true);
    setError(null);

    loadMessagesFromApi(selectedId, me.id, conv.otherUser.id, ctrl.signal)
      .then((msgs) => {
        if (!ctrl.signal.aborted) {
          setMessages((prev) => mergeServerMessages(prev, msgs));
          setMsgsLoading(false);
        }
      })
      .catch((e) => {
        if (!ctrl.signal.aborted && e.name !== "AbortError") {
          setError("Не удалось загрузить сообщения");
        }
        setMsgsLoading(false);
      });

    return () => ctrl.abort();
  }, [selectedId, me, conversations]);

  // ── Send message ───────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    if (!me || !selectedId || !draft.trim() || sending) return;
    const text = draft.trim();
    setDraft("");
    setSending(true);
    setError(null);

    const conv = conversations.find((c) => c.id === selectedId)!;
    const tempId = `local-${Date.now().toString(36)}`;
    const sentAt = new Date().toISOString();
    const clientMsgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // Optimistic insert — use client_msg_id so WS handler can dedup
    setMessages((prev) => [
      ...prev,
      {
        id: tempId, conversation_id: selectedId, sender_user_id: me.id,
        client_message_id: clientMsgId, sent_at: sentAt, content_encrypted: "", content: text,
        plainText: text, peerDeliveredAt: null, peerReadAt: null, localStatus: "pending",
      } as MessageView,
    ]);

    try {
      const { data, error: insertErr } = await api
        .from("chat_messages" as never)
        .insert({
          conversation_id: selectedId,
          sender_user_id: me.id,
          client_message_id: clientMsgId,
          content: text,
        } as never)
        .select("id, conversation_id, sender_user_id, client_message_id, sent_at, content_encrypted, content")
        .single();

      if (insertErr || !data) throw insertErr ?? new Error("Пустой ответ");

      // Replace pending with confirmed server message
      setMessages((prev) =>
        prev
          .filter((m) => m.id !== tempId)
          .concat({ ...(data as ChatMessageRecord), plainText: text, peerDeliveredAt: null, peerReadAt: null })
          .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()),
      );

      // Fire-and-forget: mark as delivered
      const msgId = (data as ChatMessageRecord).id;
      void api.rpc("chat_mark_delivered", { target_conversation_id: selectedId, target_message_id: msgId });
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, localStatus: "pending" as const } : m)));
      setError("Не удалось отправить сообщение");
    } finally {
      setSending(false);
    }
  }, [me, selectedId, draft, sending, conversations]);

  // ── Retry failed message ───────────────────────────────────────────────
  const retryMessage = useCallback(
    async (msg: MessageView) => {
      if (sending || !me || !selectedId) return;
      setSending(true);
      setError(null);
      try {
        const { data, error: insertErr } = await api
          .from("chat_messages" as never)
          .insert({
            conversation_id: selectedId,
            sender_user_id: me.id,
            client_message_id: msg.client_message_id || undefined,
            content: msg.plainText,
          } as never)
          .select("id, conversation_id, sender_user_id, client_message_id, sent_at, content_encrypted, content")
          .single();
        if (insertErr || !data) throw insertErr ?? new Error("Пустой ответ");
        setMessages((prev) =>
          prev
            .filter((m) => m.id !== msg.id)
            .concat({ ...(data as ChatMessageRecord), plainText: msg.plainText, peerDeliveredAt: null, peerReadAt: null })
            .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()),
        );
      } catch (e) {
        setError("Не удалось отправить сообщение");
      } finally {
        setSending(false);
      }
    },
    [me, selectedId, sending],
  );

  // ── Start conversation with target user ────────────────────────────────
  const startConversation = useCallback(
    async (userId: string, targetId: string): Promise<string | null> => {
      if (targetId === userId) return null;
      setStartingChat(true);
      try {
        const { data, error: rpcErr } = await api.rpc("get_or_create_direct_chat", { target_user_id: targetId });
        if (rpcErr) throw new Error(typeof rpcErr === "string" ? rpcErr : "Ошибка");
        const raw = data ?? "";
        const convId: string =
          typeof raw === "object" && raw !== null && "conversation_id" in raw
            ? (raw as { conversation_id: string }).conversation_id
            : String(raw).replace(/^"|"$/g, "");
        if (!convId) throw new Error("Не удалось получить ID диалога");
        updateUrl(convId, targetId);
        setSelectedId(convId);
        setSidebarOpen(false);
        const views = await loadConversationsFromApi(userId);
        setConversations(views);
        return convId;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось открыть диалог");
        return null;
      } finally {
        setStartingChat(false);
      }
    },
    [updateUrl],
  );

  // ── Mark messages as read ──────────────────────────────────────────────
  const markRead = useCallback(
    (convId: string, msgId: string) => {
      void api.rpc("chat_mark_read", { target_conversation_id: convId, target_message_id: msgId });
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0 } : c)),
      );
    },
    [],
  );

  // ── WebSocket: subscribe to current conversation ──────────────────────
  useEffect(() => {
    if (!selectedId) return;
    const room = `chat_${selectedId}`;
    ws.subscribe(room);

    const unsub = ws.on("new_chat_message", (rawEvent) => {
      const ev = rawEvent as Record<string, unknown>;
      const msgConvId = String(ev.conversation_id ?? "");
      const msgId = ev.id as string;
      if (!msgId) return;

      const msg = {
        ...ev,
        plainText: (ev.content as string) || "[Сообщение]",
        peerDeliveredAt: null,
        peerReadAt: null,
      } as unknown as MessageView;

      if (msgConvId === selectedId) {
        // Dedup by both server id and client_message_id
        const cid = ev.client_message_id as string | undefined;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msgId)) return prev;
          if (cid && prev.some((m) => m.client_message_id === cid)) return prev;
          return [...prev, msg].sort(
            (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
          );
        });
      } else {
        // Message for another conversation — update sidebar
        setConversations((prev) =>
          prev.map((c) =>
            c.id === msgConvId
              ? { ...c, lastMessageAt: (ev.sent_at as string) ?? c.lastMessageAt, unreadCount: c.unreadCount + 1 }
              : c,
          ),
        );
      }
    });

    return () => {
      unsub();
      ws.unsubscribe(room);
    };
  }, [selectedId, ws]);

  // ── Pinned message fetch ───────────────────────────────────────────────
  useEffect(() => {
    const pinnedId = conversation?.pinnedMessageId;
    if (!pinnedId) { setPinnedInfo(null); return; }
    const found = messages.find((m) => m.id === pinnedId);
    if (found) {
      setPinnedInfo({
        id: found.id, plainText: found.plainText, sender_user_id: found.sender_user_id,
        sender_username: conversation!.otherUser.username, sent_at: found.sent_at,
      });
      return;
    }
    // Fetch from server
    const token = localStorage.getItem("auth_token");
    fetch(`/api/v1/chat_messages?select=id,sender_user_id,content,sent_at&id=eq.${pinnedId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((json) => {
        const row = (json.data ?? [])[0];
        if (row && conversation) {
          setPinnedInfo({
            id: row.id, plainText: row.content || "[Сообщение]",
            sender_user_id: row.sender_user_id, sender_username: conversation.otherUser.username,
            sent_at: row.sent_at,
          });
        }
      })
      .catch(() => setPinnedInfo(null));
  }, [conversation?.pinnedMessageId, messages]);

  // ── Toggle pin ─────────────────────────────────────────────────────────
  const togglePin = useCallback(
    async (msg: MessageView) => {
      if (!me || !selectedId) return;
      try {
        const result = await api.rpc("chat_toggle_pin_message", {
          target_conversation_id: selectedId, target_message_id: msg.id,
        });
        const newPinned: string | null = (result as any)?.data?.pinned_message_id ?? null;
        setConversations((prev) =>
          prev.map((c) => (c.id === selectedId ? { ...c, pinnedMessageId: newPinned } : c)),
        );
        if (!newPinned) setPinnedInfo(null);
      } catch (e) {
        setError("Не удалось закрепить сообщение");
      }
    },
    [me, selectedId],
  );

  // ── Focus: merge server messages + mark read ──────────────────────────
  useEffect(() => { msgsRef.current = messages; }, [messages]);
  const lastFocus = useRef(0);
  useEffect(() => {
    if (!selectedId || !me) return;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocus.current < 5000) return;
      lastFocus.current = now;

      const conv = conversations.find((c) => c.id === selectedId);
      if (!conv) return;

      // Merge server messages with pending (don't lose optimistic inserts during reload)
      const cid = selectedId;
      loadMessagesFromApi(cid, me.id, conv.otherUser.id)
        .then((serverMsgs) => {
          if (selectedId !== cid) return;
          setMessages((prev) => mergeServerMessages(prev, serverMsgs));
        })
        .catch(() => {});

      const last = msgsRef.current.at(-1);
      if (last && last.localStatus !== "pending" && !last.id.startsWith("local-")) {
        markRead(selectedId, last.id);
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, me, conversations, markRead]);

  // ── Composer auto-resize ───────────────────────────────────────────────
  useEffect(() => {
    const c = composerRef.current;
    if (!c) return;
    c.style.height = "0px";
    c.style.height = `${Math.min(c.scrollHeight, 140)}px`;
  }, [draft]);

  // ── Render ─────────────────────────────────────────────────────────────
  // Show shell immediately — sidebar + chat (no full-screen loader after init)

  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0);

  return (
    <MessengerErrorBoundary>
      <div className="messenger-app">
        <div className={`messenger-shell ${showMobileChat ? "mobile-chat-open" : ""}`}>
          <aside className={`sidebar-panel ${sidebarOpen ? "is-open" : ""}`}>
            <ConversationList
              conversations={conversations}
              selectedConversationId={selectedId}
              openConversation={(c) => { setSelectedId(c.id); setSidebarOpen(false); updateUrl(c.id, c.otherUser.id); }}
              conversationsLoading={initLoading}
              errorMessage={error}
              startingConversation={startingChat}
              targetUserId={searchParams.get("user")}
              ensureConversation={startConversation}
              loadConversations={async () => { const v = await loadConversationsFromApi(me.id); setConversations(v); return v; }}
              me={me}
              totalUnread={totalUnread}
              onDismissError={() => setError(null)}
            />
          </aside>
          <section className={`chat-panel ${showMobileChat ? "is-open" : ""}`}>
            {conversation && me ? (
              <ChatView
                selectedConversation={conversation}
                messages={messages}
                messagesLoading={msgsLoading}
                hasMoreMessages={false}
                loadingMore={false}
                loadOlderMessages={() => {}}
                onRetryMessage={retryMessage}
                me={me}
                draft={draft}
                setDraft={setDraft}
                sending={sending}
                sendMessage={sendMessage}
                pinnedMessageInfo={pinnedInfo}
                onTogglePin={togglePin}
                composerRef={composerRef}
                messageScrollRef={msgScrollRef}
                endRef={endRef}
                onBack={() => { setSidebarOpen(true); setSelectedId(null); updateUrl(null, null); }}
                errorMessage={error}
                onDismissError={() => setError(null)}
              />
            ) : (
              <div className="empty-thread hero">
                <MessageCircle size={18} />
                <h2>Выбери диалог</h2>
                <p>Открой переписку слева или начни разговор из профиля любого пользователя.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </MessengerErrorBoundary>
  );
};
