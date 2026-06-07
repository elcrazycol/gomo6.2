import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams, type NavigateOptions } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { api } from "@/integrations/api/compat";
import { useWebSocket } from "@/contexts/WebSocketContext";
import { MessengerErrorBoundary } from "./ErrorBoundary";
import { ConversationList } from "./ConversationList";
import { ChatView } from "./ChatView";
import { mergeMessages } from "./types";
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

// ─── Pure helpers ───

const fetchMyProfile = async (userId: string): Promise<ProfileSummary> => {
  const { data, error } = await api
    .from("profiles")
    .select("id, username, avatar_url, account_number, is_online, last_seen_at")
    .eq("id", userId)
    .single();

  if (error || !data) throw new Error("Не удалось загрузить твой профиль");
  return data as ProfileSummary;
};

const fetchMessageReceipts = async (messageIds: string[]): Promise<ChatReceiptRecord[]> => {
  if (messageIds.length === 0) return [];
  const { data: receiptRows, error: receiptError } = await api
    .from("chat_receipts" as never)
    .select("message_id, user_id, delivered_at, read_at")
    .in("message_id", messageIds);

  if (receiptError) throw receiptError;
  return (receiptRows ?? []) as ChatReceiptRecord[];
};

const processMessages = (
  serverMessages: ChatMessageRecord[],
  userId: string,
  otherUserId: string,
  receiptRows: ChatReceiptRecord[],
): MessageView[] => {
  return serverMessages.map((message) => {
    const peerReceipt =
      receiptRows.find(
        (receipt) => receipt.message_id === message.id && receipt.user_id === otherUserId,
      ) ?? null;

    return {
      ...message,
      plainText: message.content || "[Сообщение]",
      peerDeliveredAt: peerReceipt?.delivered_at ?? null,
      peerReadAt: peerReceipt?.read_at ?? null,
    } satisfies MessageView;
  });
};

// ─── Component ───

export const MessengerView = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const targetUserId = searchParams.get("user");
  const requestedConversationId = searchParams.get("conversation");
  const [me, setMe] = useState<ProfileSummary | null>(null);
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(requestedConversationId);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [startingConversation, setStartingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pinnedMessageInfo, setPinnedMessageInfo] = useState<PinnedMessageInfo>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const lastReadMessageIdRef = useRef<string | null>(null);
  const visibleConversationIdRef = useRef<string | null>(null);
  const meRef = useRef<ProfileSummary | null>(null);
  const conversationsRef = useRef<ConversationView[]>([]);
  const selectedConversationRef = useRef<ConversationView | null>(null);
  const messagesRef = useRef<MessageView[]>([]);
  const lastDeliveredMessageIdRef = useRef<string | null>(null);
  const isNearBottomRef = useRef(true);
  const oldestSentAtRef = useRef<string | null>(null);
  const previousConversationIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const loadIdRef = useRef(0);
  const ws = useWebSocket();

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );
  const shouldShowMobileChat = Boolean(selectedConversation) && (!isMobileViewport || !mobileSidebarOpen);

  const openConversation = useCallback((conversation: ConversationView) => {
    setSelectedConversationId(conversation.id);
    setMobileSidebarOpen(false);
    updateSearchRef(conversation.id, conversation.otherUser.id);
  }, []);

  // Keep refs in sync
  useEffect(() => { meRef.current = me; }, [me]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { selectedConversationRef.current = selectedConversation; visibleConversationIdRef.current = selectedConversation?.id ?? null; }, [selectedConversation]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 980px)");
    const update = () => setIsMobileViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const updateSearchRef = useCallback(
    (conversationId: string | null, userId: string | null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (conversationId) next.set("conversation", conversationId);
        else next.delete("conversation");
        if (userId) next.set("user", userId);
        else next.delete("user");
        return next;
      }, { replace: true } as NavigateOptions);
    },
    [setSearchParams],
  );

  // Mobile sidebar logic
  useEffect(() => {
    if (!isMobileViewport) return;
    if (targetUserId) return;
    if (requestedConversationId) updateSearchRef(null, null);
    setSelectedConversationId(null);
    setMobileSidebarOpen(true);
  }, [isMobileViewport, requestedConversationId, targetUserId, updateSearchRef]);

  // Body class for mobile chrome hiding
  useEffect(() => {
    if (typeof document === "undefined") return;
    const shouldHideChrome = isMobileViewport && shouldShowMobileChat;
    document.body.classList.toggle("messenger-mobile-chat-active", shouldHideChrome);
    return () => { document.body.classList.remove("messenger-mobile-chat-active"); };
  }, [isMobileViewport, shouldShowMobileChat]);

  const resizeComposer = useCallback(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 140)}px`;
  }, []);

  const loadConversations = useCallback(
    async (userId: string, options?: { silent?: boolean }) => {
      if (!mountedRef.current) return [];
      const loadId = ++loadIdRef.current;
      if (!options?.silent) setConversationsLoading(true);

      try {
        const { data: memberships, error: membershipError } = await api
          .from("chat_conversation_members" as never)
          .select("conversation_id,unread_count_cache,last_read_at")
          .eq("user_id", userId)
          .is("archived_at", null)
          .order("updated_at", { ascending: false });

        if (membershipError) throw new Error("Failed to load conversations");

        const conversationIds = ((memberships as ConversationRow[]) || []).map((row) => row.conversation_id);
        if (conversationIds.length === 0) {
          if (mountedRef.current && loadId === loadIdRef.current) {
            setConversations([]);
            setSelectedConversationId(null);
          }
          return [];
        }

        const [conversationsResult, membersResult, profilesResult] = await Promise.all([
          api.from("chat_conversations" as never).select("id,last_message_at,updated_at,pinned_message_id").in("id", conversationIds),
          api.from("chat_conversation_members" as never).select("conversation_id,user_id").in("conversation_id", conversationIds),
          api.from("profiles").select("id,username,avatar_url,account_number,is_online,last_seen_at"),
        ]);

        if (conversationsResult.error || membersResult.error || profilesResult.error)
          throw new Error("Failed to load conversation data");

        const conversationsRows = (conversationsResult.data || []) as ConversationRecord[];
        const membersRows = (membersResult.data || []) as ConversationMemberRecord[];
        const allProfiles = (profilesResult.data || []) as ProfileSummary[];

        const otherUserIds = Array.from(new Set(
          membersRows.filter((row) => row.user_id !== userId).map((row) => row.user_id),
        ));
        const profileMap = new Map(allProfiles.filter((p) => otherUserIds.includes(p.id)).map((row) => [row.id, row]));

        const views = ((memberships as ConversationRow[]) || [])
          .map((membership) => {
            const otherMember = membersRows.find(
              (row) => row.conversation_id === membership.conversation_id && row.user_id !== userId,
            );
            if (!otherMember) return null;
            const profile = profileMap.get(otherMember.user_id);
            if (!profile) return null;
            const conversation = conversationsRows.find((c) => c.id === membership.conversation_id);
            if (!conversation) return null;

            return {
              id: membership.conversation_id,
              unreadCount: membership.unread_count_cache ?? 0,
              lastReadAt: membership.last_read_at,
              lastMessageAt: conversation.last_message_at,
              pinnedMessageId: conversation.pinned_message_id ?? null,
              otherUser: profile,
            } satisfies ConversationView;
          })
          .filter((v): v is ConversationView => v !== null)
          .sort((a, b) => {
            const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
            const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
            return bTime - aTime;
          });

        if (!mountedRef.current || loadId !== loadIdRef.current) return views;

        setConversations(views);
        setSelectedConversationId((current) => {
          if (targetUserId) return views.find((v) => v.otherUser.id === targetUserId)?.id ?? current ?? null;
          if (current && views.some((v) => v.id === current)) return current;
          if (!isMobileViewport && requestedConversationId && views.some((v) => v.id === requestedConversationId)) return requestedConversationId;
          if (!isMobileViewport) return views[0]?.id ?? null;
          return null;
        });
        return views;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось загрузить диалоги";
        if (!mountedRef.current || loadId !== loadIdRef.current) throw error;
        throw new Error(message);
      } finally {
        if (!options?.silent && mountedRef.current) setConversationsLoading(false);
      }
    },
    [isMobileViewport, requestedConversationId, targetUserId],
  );

  const loadMessages = useCallback(
    async (conversationId: string, otherUserId: string, options?: { incremental?: boolean; cursor?: string | null }) => {
      const loadId = ++loadIdRef.current;
      const isIncremental = options?.incremental ?? false;
      const cursor = options?.cursor;
      const isLoadMore = cursor !== undefined && cursor !== null;

      if (!mountedRef.current) return [];
      if (!isIncremental && !isLoadMore) {
        setMessagesLoading(true);
        setHasMoreMessages(true);
        oldestSentAtRef.current = null;
      }

      try {
        const query = api
          .from("chat_messages" as never)
          .select("id, conversation_id, sender_user_id, client_message_id, sent_at, content_encrypted, content")
          .eq("conversation_id", conversationId)
          .order("sent_at", { ascending: false })
          .limit(50);

        if (isLoadMore && cursor) query.lt("sent_at", cursor);

        const { data: messageRows, error: messageError } = await query;
        if (messageError) throw messageError;
        if (!mountedRef.current || loadId !== loadIdRef.current) return [];

        const serverMessages = ((messageRows ?? []) as ChatMessageRecord[]).reverse();
        const couldHaveMore = (messageRows ?? []).length >= 50;

        if (serverMessages.length > 0 && !isIncremental)
          oldestSentAtRef.current = serverMessages[0].sent_at;

        const receiptRows = await fetchMessageReceipts(serverMessages.map((m) => m.id));
        if (!mountedRef.current || loadId !== loadIdRef.current) return [];

        const currentMe = meRef.current;
        if (!currentMe) return [];

        const normalized = processMessages(serverMessages, currentMe.id, otherUserId, receiptRows);

        setMessages((current) => {
          if (isIncremental) return mergeMessages(current, normalized, currentMe.id);
          if (isLoadMore) {
            const existingIds = new Set(current.map((m) => m.id));
            return [...normalized.filter((m) => !existingIds.has(m.id)), ...current];
          }
          return normalized;
        });

        if (!isIncremental) setHasMoreMessages(couldHaveMore);
        return normalized;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось загрузить сообщения";
        throw new Error(message);
      } finally {
        if (!isIncremental && !isLoadMore && mountedRef.current) setMessagesLoading(false);
      }
    },
    [],
  );

  const loadOlderMessages = useCallback(async () => {
    const currentMe = meRef.current;
    const currentConversation = selectedConversationRef.current;
    if (!currentMe || !currentConversation || loadingMore || !hasMoreMessages) return;
    setLoadingMore(true);
    try {
      await loadMessages(currentConversation.id, currentConversation.otherUser.id, { cursor: oldestSentAtRef.current });
    } catch (error) {
      console.error("Failed to load older messages:", error);
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [loadMessages, loadingMore, hasMoreMessages]);

  const ensureConversation = useCallback(
    async (userId: string, targetId: string) => {
      if (targetId === userId) return null;
      setStartingConversation(true);
      try {
        const result = await (api.rpc as any)("get_or_create_direct_chat", { target_user_id: targetId });
        const cleanId = typeof result === "string" ? result.replace(/^"|"$/g, "") : String(result ?? "");
        updateSearchRef(cleanId, targetId);
        setSelectedConversationId(cleanId);
        setMobileSidebarOpen(false);
        return cleanId;
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Не удалось открыть диалог");
        return null;
      } finally {
        if (mountedRef.current) setStartingConversation(false);
      }
    },
    [updateSearchRef],
  );

  const markDelivered = useCallback(
    async (conversationId: string, latestMessageId: string | null) => {
      if (!latestMessageId || lastDeliveredMessageIdRef.current === latestMessageId) return;
      try {
        await api.rpc("chat_mark_delivered", { target_conversation_id: conversationId, target_message_id: latestMessageId });
        lastDeliveredMessageIdRef.current = latestMessageId;
      } catch (error) { console.warn("Failed to mark delivered:", error); }
    },
    [],
  );

  const markRead = useCallback(
    async (conversationId: string, latestMessageId: string | null) => {
      if (!latestMessageId || lastReadMessageIdRef.current === latestMessageId) return;
      try {
        await api.rpc("chat_mark_read", { target_conversation_id: conversationId, target_message_id: latestMessageId });
        lastReadMessageIdRef.current = latestMessageId;
        setConversations((current) =>
          current.map((c) =>
            c.id === conversationId
              ? { ...c, unreadCount: 0, lastReadAt: messagesRef.current.at(-1)?.sent_at ?? c.lastReadAt }
              : c,
          ),
        );
      } catch (error) { console.warn("Failed to mark read:", error); }
    },
    [],
  );

  const refreshCurrentConversation = useCallback(
    async (incremental = true) => {
      const currentMe = meRef.current;
      const currentConversation = selectedConversationRef.current;
      if (!currentMe || !currentConversation) return;
      await loadMessages(currentConversation.id, currentConversation.otherUser.id, { incremental });
    },
    [loadMessages],
  );

  const sendMessage = useCallback(async () => {
    const currentMe = meRef.current;
    const currentConversation = selectedConversationRef.current;
    const currentDraft = draftRef.current;
    if (!currentMe || !currentConversation || !currentDraft.trim() || sending) return;

    const plainText = currentDraft.trim();
    const clientMessageId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const localId = `local-${clientMessageId}`;
    const sentAt = new Date().toISOString();

    if (!mountedRef.current) return;
    setSending(true);
    setDraft("");

    setMessages((prev) => [
      ...prev,
      {
        id: localId, conversation_id: currentConversation.id, sender_user_id: currentMe.id,
        client_message_id: clientMessageId, sent_at: sentAt, content_encrypted: "", content: plainText,
        plainText, peerDeliveredAt: null, peerReadAt: null, localStatus: "pending",
      } as MessageView,
    ]);

    setConversations((prev) =>
      prev.map((c) => (c.id === currentConversation.id ? { ...c, lastMessageAt: sentAt } : c)),
    );

    try {
      const { data, error } = await api
        .from("chat_messages" as never)
        .insert({
          conversation_id: currentConversation.id,
          sender_user_id: currentMe.id,
          client_message_id: clientMessageId,
          content: plainText,
        } as never)
        .select("id, conversation_id, sender_user_id, client_message_id, sent_at, content_encrypted, content")
        .single();

      if (error || !data) throw error ?? new Error("Не удалось отправить сообщение");
      if (!mountedRef.current) return;

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === localId
            ? { ...(data as ChatMessageRecord), plainText, peerDeliveredAt: null, peerReadAt: null }
            : msg,
        ),
      );
      void refreshCurrentConversation(true).catch(() => undefined);
      setErrorMessage(null);
    } catch (error) {
      if (!mountedRef.current) return;
      setMessages((prev) =>
        prev.map((msg) => (msg.id === localId ? { ...msg, localStatus: "pending" as const } : msg)),
      );
      setDraft((prev) => prev || plainText);
      setErrorMessage(error instanceof Error ? error.message : "Не удалось отправить сообщение");
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }, []);

  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  const onRetryMessage = useCallback(
    async (message: MessageView) => {
      if (sending || !me) return;
      const currentConversation = selectedConversationRef.current;
      if (!currentConversation) return;

      setSending(true);
      setErrorMessage(null);
      try {
        const { data, error } = await api
          .from("chat_messages" as never)
          .insert({
            conversation_id: currentConversation.id,
            sender_user_id: me.id,
            client_message_id: message.client_message_id,
            content: message.plainText,
          } as never)
          .select("id, conversation_id, sender_user_id, client_message_id, sent_at, content_encrypted, content")
          .single();

        if (error || !data) throw error ?? new Error("Не удалось отправить сообщение");
        if (!mountedRef.current) return;

        setMessages((prev) => {
          const filtered = prev.filter((m) => m.client_message_id !== message.client_message_id);
          return [...filtered, { ...(data as ChatMessageRecord), plainText: message.plainText, peerDeliveredAt: null, peerReadAt: null }]
            .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
        });
        void refreshCurrentConversation(true).catch(() => undefined);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Не удалось отправить сообщение");
      } finally {
        if (mountedRef.current) setSending(false);
      }
    },
    [me, sending],
  );

  useEffect(() => { resizeComposer(); }, [draft, resizeComposer]);

  // Bootstrap
  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      try {
        const { data: { user } } = await api.auth.getUser();
        if (!user) { navigate("/auth"); return; }
        if (!mountedRef.current) return;

        const profile = await fetchMyProfile(user.id);
        if (!mountedRef.current) return;
        setMe(profile);
        await loadConversations(user.id);

        if (!targetUserId && mountedRef.current) {
          setMobileSidebarOpen(true);
          setSelectedConversationId(null);
        }
      } catch (error) {
        if (mountedRef.current) setErrorMessage(error instanceof Error ? error.message : "Не удалось инициализировать messenger");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };
    void bootstrap();
  }, [loadConversations, navigate, targetUserId]);

  // Handle targetUserId from URL
  useEffect(() => {
    if (!me || !targetUserId || targetUserId === me.id) return;
    const handleTargetUser = async () => {
      try {
        const existing = conversations.find((c) => c.otherUser.id === targetUserId);
        if (existing) {
          setSelectedConversationId(existing.id);
          setMobileSidebarOpen(false);
          updateSearchRef(existing.id, targetUserId);
          return;
        }
        const conversationId = await ensureConversation(me.id, targetUserId);
        if (conversationId) await loadConversations(me.id);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Не удалось открыть диалог");
      }
    };
    void handleTargetUser();
  }, [conversations, ensureConversation, loadConversations, me, targetUserId, updateSearchRef]);

  // Load messages when conversation changes
  useEffect(() => {
    if (!me || !selectedConversation) { setMessages([]); return; }
    visibleConversationIdRef.current = selectedConversation.id;
    lastReadMessageIdRef.current = null;
    lastDeliveredMessageIdRef.current = null;
    void loadMessages(selectedConversation.id, selectedConversation.otherUser.id, {}).catch((error) => {
      if (mountedRef.current) setErrorMessage(error.message);
    });
  }, [loadMessages, me, selectedConversation]);

  // Sync selectedConversationId
  useEffect(() => {
    if (!me) return;
    if (selectedConversationId && !conversations.some((c) => c.id === selectedConversationId))
      setSelectedConversationId(conversations[0]?.id ?? null);
  }, [conversations, me, selectedConversationId]);

  // Scroll handler
  useEffect(() => {
    const container = messageScrollRef.current;
    if (!container) return;
    const onScroll = () => {
      const d = container.scrollHeight - container.scrollTop - container.clientHeight;
      isNearBottomRef.current = d <= 64;
    };
    onScroll();
    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, [selectedConversationId]);

  // Auto-scroll
  useEffect(() => {
    const container = messageScrollRef.current;
    if (!container) return;
    const changed = previousConversationIdRef.current !== selectedConversationId;
    previousConversationIdRef.current = selectedConversationId;
    if (!(changed || isNearBottomRef.current)) return;
    container.scrollTop = container.scrollHeight;
    endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    isNearBottomRef.current = true;
  }, [messages, selectedConversationId]);

  // Mark delivered/read
  useEffect(() => {
    if (!me || !selectedConversation || messages.length === 0) return;
    const latestMessage = messages.at(-1);
    if (!latestMessage || latestMessage.localStatus === "pending") return;
    void markDelivered(selectedConversation.id, latestMessage.id).catch(() => undefined);
    if (document.visibilityState === "visible")
      void markRead(selectedConversation.id, latestMessage.id).catch(() => undefined);
  }, [markDelivered, markRead, me, messages, selectedConversation]);

  // WebSocket subscription
  useEffect(() => {
    if (!selectedConversation) return;
    const chatRoom = `chat_${selectedConversation.id}`;
    ws.subscribe(chatRoom);
    const unsubscribe = ws.on("new_chat_message", () => {
      void refreshCurrentConversation(true).catch(() => undefined);
    });
    return () => { unsubscribe(); ws.unsubscribe(chatRoom); };
  }, [refreshCurrentConversation, selectedConversation, ws]);

  // Pinned message
  useEffect(() => {
    if (!selectedConversation?.pinnedMessageId) { setPinnedMessageInfo(null); return; }
    const pinnedId = selectedConversation.pinnedMessageId;
    const found = messages.find((m) => m.id === pinnedId);
    if (found) {
      setPinnedMessageInfo({
        id: found.id, plainText: found.plainText, sender_user_id: found.sender_user_id,
        sender_username: selectedConversation.otherUser.username, sent_at: found.sent_at,
      });
      return;
    }
    const fetchPinnedMessage = async () => {
      try {
        const { data } = await api.from("chat_messages" as never)
          .select("id, sender_user_id, content, sent_at").eq("id", pinnedId).single();
        if (data && meRef.current) {
          setPinnedMessageInfo({
            id: data.id as string, plainText: (data as any).content || "[Сообщение]",
            sender_user_id: (data as any).sender_user_id, sender_username: selectedConversation.otherUser.username,
            sent_at: (data as any).sent_at,
          });
        }
      } catch (err) { console.warn("Failed to fetch pinned message:", err); setPinnedMessageInfo(null); }
    };
    void fetchPinnedMessage();
  }, [selectedConversation?.pinnedMessageId, messages]);

  const onTogglePin = useCallback(
    async (message: MessageView) => {
      const currentConversation = selectedConversationRef.current;
      if (!me || !currentConversation) return;
      try {
        const result = await api.rpc("chat_toggle_pin_message", {
          target_conversation_id: currentConversation.id, target_message_id: message.id,
        });
        const newPinnedId: string | null = (result as any)?.data?.pinned_message_id ?? null;
        setConversations((prev) => prev.map((c) => (c.id === currentConversation.id ? { ...c, pinnedMessageId: newPinnedId } : c)));
        if (!newPinnedId) setPinnedMessageInfo(null);
        void refreshCurrentConversation(true).catch(() => undefined);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Не удалось закрепить сообщение");
      }
    },
    [me, refreshCurrentConversation],
  );

  // Focus handler
  useEffect(() => {
    if (!selectedConversation) return;
    const onFocus = () => {
      if (!mountedRef.current || !visibleConversationIdRef.current) return;
      const latestMessage = messagesRef.current.at(-1);
      if (!latestMessage || latestMessage.localStatus === "pending") return;
      void markRead(visibleConversationIdRef.current, latestMessage.id).catch(() => undefined);
      void refreshCurrentConversation(true).catch(() => undefined);
      void loadConversations(meRef.current?.id ?? "", { silent: true }).catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [markRead, refreshCurrentConversation, loadConversations, selectedConversation]);

  if (loading || !me) {
    return (
      <MessengerErrorBoundary>
        <div className="messenger-loading-page"><PentagramLoader size="lg" /></div>
      </MessengerErrorBoundary>
    );
  }

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <MessengerErrorBoundary>
      <div className="messenger-app">
        <div className={`messenger-shell ${shouldShowMobileChat ? "mobile-chat-open" : ""}`}>
          <aside className={`sidebar-panel ${mobileSidebarOpen ? "is-open" : ""}`}>
            <ConversationList
              conversations={conversations}
              selectedConversationId={selectedConversationId}
              openConversation={openConversation}
              conversationsLoading={conversationsLoading}
              errorMessage={errorMessage}
              startingConversation={startingConversation}
              targetUserId={targetUserId}
              ensureConversation={ensureConversation}
              loadConversations={loadConversations}
              me={me}
              totalUnread={totalUnread}
              onDismissError={() => setErrorMessage(null)}
            />
          </aside>
          <section className={`chat-panel ${shouldShowMobileChat ? "is-open" : ""}`}>
            {selectedConversation ? (
              <ChatView
                selectedConversation={selectedConversation}
                messages={messages}
                messagesLoading={messagesLoading}
                hasMoreMessages={hasMoreMessages}
                loadingMore={loadingMore}
                loadOlderMessages={loadOlderMessages}
                onRetryMessage={onRetryMessage}
                me={me}
                draft={draft}
                setDraft={setDraft}
                sending={sending}
                sendMessage={sendMessage}
                pinnedMessageInfo={pinnedMessageInfo}
                onTogglePin={onTogglePin}
                composerRef={composerRef}
                messageScrollRef={messageScrollRef}
                endRef={endRef}
                onBack={() => { setMobileSidebarOpen(true); setSelectedConversationId(null); updateSearchRef(null, null); }}
                errorMessage={errorMessage}
                onDismissError={() => setErrorMessage(null)}
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
