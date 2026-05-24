import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams, type NavigateOptions } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { api } from "@/integrations/api/compat";
import {
  createClientMessageId,
  decryptMessengerText,
  encryptMessengerText,
  ensureLocalMessengerState,
} from "@/lib/messengerCrypto";
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

// ─── Pure helpers extracted outside component ───

const fetchMyProfile = async (userId: string): Promise<ProfileSummary> => {
  const { data, error } = await api
    .from("profiles")
    .select("id, username, avatar_url, account_number, is_online, last_seen_at")
    .eq("id", userId)
    .single();

  if (error || !data) {
    throw new Error("Не удалось загрузить твой профиль");
  }

  return data as ProfileSummary;
};

const ensureKeyForCurrentUser = async (userId: string) => {
  const cryptoState = await ensureLocalMessengerState(userId);

  // Check if key already exists
  const { data: existing, error: selectError } = await api
    .from("chat_user_keys" as never)
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (selectError && selectError.code !== "PGRST116") {
    console.warn("Error checking existing key:", selectError);
  }

  if (existing) {
    const { error } = await api
      .from("chat_user_keys" as never)
      .update({
        public_key: cryptoState.publicKey,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("user_id", userId);

    if (error) {
      console.warn("Error updating key:", error);
    }
  } else {
    const { error } = await api
      .from("chat_user_keys" as never)
      .insert({
        user_id: userId,
        public_key: cryptoState.publicKey,
      } as never);

    if (error && !error.message?.includes("duplicate key")) {
      throw new Error("Не удалось зарегистрировать messenger-ключ");
    }
  }

  return cryptoState;
};

const fetchMessageReceipts = async (
  messageIds: string[],
): Promise<ChatReceiptRecord[]> => {
  if (messageIds.length === 0) return [];
  const { data: receiptRows, error: receiptError } = await api
    .from("chat_receipts" as never)
    .select("message_id, user_id, delivered_at, read_at")
    .in("message_id", messageIds);

  if (receiptError) throw receiptError;
  return (receiptRows ?? []) as ChatReceiptRecord[];
};

const decryptMessages = async (
  serverMessages: ChatMessageRecord[],
  userId: string,
  otherUserId: string,
  receiptRows: ChatReceiptRecord[],
): Promise<MessageView[]> => {
  const myCrypto = await ensureLocalMessengerState(userId);
  return Promise.all(
    serverMessages.map(async (message) => {
      const peerReceipt =
        receiptRows.find(
          (receipt) =>
            receipt.message_id === message.id &&
            receipt.user_id === otherUserId,
        ) ?? null;

      let plainText = "[Не удалось расшифровать сообщение]";
      if (message.ciphertext) {
        if (message.ciphertext.startsWith("BOT_PLAINTEXT:")) {
          plainText = message.ciphertext.substring("BOT_PLAINTEXT:".length);
        } else if (message.nonce) {
          const peerPublicKey =
            message.sender_user_id === userId
              ? message.recipient_public_key
              : message.sender_public_key;

          if (peerPublicKey) {
            try {
              plainText = await decryptMessengerText({
                cipherText: message.ciphertext,
                nonce: message.nonce,
                peerPublicKey,
                myPrivateKey: myCrypto.privateKey,
              });
            } catch (err) {
              console.error("Decryption error:", err);
              plainText = "[Не удалось расшифровать сообщение]";
            }
          }
        }
      }

      return {
        ...message,
        plainText,
        peerDeliveredAt: peerReceipt?.delivered_at ?? null,
        peerReadAt: peerReceipt?.read_at ?? null,
      } satisfies MessageView;
    }),
  );
};

// ─── Component ───

export const MessengerView = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const targetUserId = searchParams.get("user");
  const requestedConversationId = searchParams.get("conversation");
  const [me, setMe] = useState<ProfileSummary | null>(null);
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(requestedConversationId);
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
  const loadIdRef = useRef(0); // monotonic load counter to prevent race conditions
  const ws = useWebSocket();

  // Track mounted state for cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const selectedConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === selectedConversationId,
      ) ?? null,
    [conversations, selectedConversationId],
  );
  const shouldShowMobileChat =
    Boolean(selectedConversation) &&
    (!isMobileViewport || !mobileSidebarOpen);

  const openConversation = useCallback(
    (conversation: ConversationView) => {
      setSelectedConversationId(conversation.id);
      setMobileSidebarOpen(false);
      updateSearchRef(conversation.id, conversation.otherUser.id);
    },
    [],
  );

  // Keep refs in sync
  useEffect(() => {
    meRef.current = me;
  }, [me]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
    visibleConversationIdRef.current = selectedConversation?.id ?? null;
  }, [selectedConversation]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 980px)");
    const update = () => setIsMobileViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Stable search params ref to avoid recreating callbacks
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  const updateSearchRef = useCallback(
    (conversationId: string | null, userId: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (conversationId) {
            next.set("conversation", conversationId);
          } else {
            next.delete("conversation");
          }
          if (userId) {
            next.set("user", userId);
          } else {
            next.delete("user");
          }
          return next;
        },
        { replace: true } as NavigateOptions,
      );
    },
    [setSearchParams],
  );

  // Mobile sidebar logic
  useEffect(() => {
    if (!isMobileViewport) return;
    if (targetUserId) return;
    if (requestedConversationId) {
      updateSearchRef(null, null);
    }
    setSelectedConversationId(null);
    setMobileSidebarOpen(true);
  }, [isMobileViewport, requestedConversationId, targetUserId, updateSearchRef]);

  // Body class for mobile chrome hiding
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    const shouldHideChrome = isMobileViewport && shouldShowMobileChat;
    document.body.classList.toggle(
      "messenger-mobile-chat-active",
      shouldHideChrome,
    );
    window.dispatchEvent(
      new CustomEvent("gomo6:messenger-mobile-chat", {
        detail: shouldHideChrome,
      }),
    );

    return () => {
      document.body.classList.remove("messenger-mobile-chat-active");
      window.dispatchEvent(
        new CustomEvent("gomo6:messenger-mobile-chat", { detail: false }),
      );
    };
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

      if (!options?.silent) {
        setConversationsLoading(true);
      }
      try {
        const { data: memberships, error: membershipError } = await api
          .from("chat_conversation_members" as never)
          .select("conversation_id,unread_count_cache,last_read_at")
          .eq("user_id", userId)
          .is("archived_at", null)
          .order("updated_at", { ascending: false });

        if (membershipError) {
          throw new Error("Failed to load conversations");
        }

        const conversationIds = (
          (memberships as ConversationRow[]) || []
        ).map((row) => row.conversation_id);

        if (conversationIds.length === 0) {
          if (mountedRef.current && loadId === loadIdRef.current) {
            setConversations([]);
            setSelectedConversationId(null);
          }
          return [];
        }

        const [conversationsResult, membersResult, profilesResult, keysResult] =
          await Promise.all([
            api
              .from("chat_conversations" as never)
              .select("id,last_message_at,updated_at,pinned_message_id")
              .in("id", conversationIds),
            api
              .from("chat_conversation_members" as never)
              .select("conversation_id,user_id")
              .in("conversation_id", conversationIds),
            api.from("profiles").select(
              "id,username,avatar_url,account_number,is_online,last_seen_at",
            ),
            api
              .from("chat_user_keys" as never)
              .select("user_id,public_key"),
          ]);

        if (
          conversationsResult.error ||
          membersResult.error ||
          profilesResult.error ||
          keysResult.error
        ) {
          throw new Error("Failed to load conversation data");
        }

        const conversationsRows = (conversationsResult.data ||
          []) as ConversationRecord[];
        const membersRows = (membersResult.data ||
          []) as ConversationMemberRecord[];
        const allProfiles = (profilesResult.data || []) as ProfileSummary[];
        const allKeys = (keysResult.data ||
          []) as Array<{ user_id: string; public_key: string }>;

        const conversationMap = new Map(
          conversationsRows.map((row) => [row.id, row]),
        );

        const otherUserIds = Array.from(
          new Set(
            membersRows
              .filter((row) => row.user_id !== userId)
              .map((row) => row.user_id),
          ),
        );

        const profileMap = new Map(
          allProfiles
            .filter((p) => otherUserIds.includes(p.id))
            .map((row) => [row.id, row]),
        );
        const keyMap = new Map(
          allKeys
            .filter((k) => otherUserIds.includes(k.user_id))
            .map((row) => [row.user_id, row.public_key]),
        );

        const views = ((memberships as ConversationRow[]) || [])
          .map((membership) => {
            const otherMember = membersRows.find(
              (row) =>
                row.conversation_id === membership.conversation_id &&
                row.user_id !== userId,
            );
            if (!otherMember) return null;

            const profile = profileMap.get(otherMember.user_id);
            if (!profile) return null;

            const conversation = conversationMap.get(
              membership.conversation_id,
            );
            if (!conversation) return null;

            return {
              id: membership.conversation_id,
              unreadCount: membership.unread_count_cache ?? 0,
              lastReadAt: membership.last_read_at,
              lastMessageAt: conversation.last_message_at,
              pinnedMessageId: conversation.pinned_message_id ?? null,
              otherUser: {
                ...profile,
                publicKey: keyMap.get(profile.id) ?? null,
              },
            } satisfies ConversationView;
          })
          .filter((value): value is ConversationView => value !== null)
          .sort((left, right) => {
            const leftTime = left.lastMessageAt
              ? new Date(left.lastMessageAt).getTime()
              : 0;
            const rightTime = right.lastMessageAt
              ? new Date(right.lastMessageAt).getTime()
              : 0;
            return rightTime - leftTime;
          });

        if (!mountedRef.current || loadId !== loadIdRef.current) {
          return views;
        }

        setConversations(views);
        setSelectedConversationId((current) => {
          if (targetUserId) {
            return (
              views.find((v) => v.otherUser.id === targetUserId)?.id ??
              current ??
              null
            );
          }
          if (
            current &&
            views.some((v) => v.id === current)
          ) {
            return current;
          }
          if (
            !isMobileViewport &&
            requestedConversationId &&
            views.some((v) => v.id === requestedConversationId)
          ) {
            return requestedConversationId;
          }
          if (!isMobileViewport) {
            return views[0]?.id ?? null;
          }
          return null;
        });

        return views;
      } catch (error) {
        if (!mountedRef.current || loadId !== loadIdRef.current) throw error;
        const message =
          error instanceof Error
            ? error.message
            : "Не удалось загрузить диалоги";
        throw new Error(message);
      } finally {
        if (!options?.silent && mountedRef.current) {
          setConversationsLoading(false);
        }
      }
    },
    [isMobileViewport, requestedConversationId, targetUserId],
  );

  const loadMessages = useCallback(
    async (
      conversationId: string,
      otherUserId: string,
      options?: {
        incremental?: boolean;
        cursor?: string | null;
      },
    ) => {
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
          .select(
            "id, conversation_id, sender_user_id, client_message_id, sent_at, ciphertext, nonce, sender_public_key, recipient_public_key",
          )
          .eq("conversation_id", conversationId)
          .order("sent_at", { ascending: false })
          .limit(50);

        if (isLoadMore && cursor) {
          query.lt("sent_at", cursor);
        }

        const { data: messageRows, error: messageError } = await query;

        if (messageError) throw messageError;

        if (!mountedRef.current || loadId !== loadIdRef.current) {
          return [];
        }

        const serverMessages = (
          (messageRows ?? []) as ChatMessageRecord[]
        ).reverse();
        const receivedCount = (messageRows ?? []).length;

        // hasMore: server returned the max page size → there might be more
        // Edge case: last page may also return exactly 50, but that's
        // acceptable UX — user taps "load more" once and gets nothing back.
        const couldHaveMore = receivedCount >= 50 && receivedCount > 0;

        // Update cursor for next "load more"
        if (serverMessages.length > 0 && !isIncremental) {
          oldestSentAtRef.current = serverMessages[0].sent_at;
        }

        const messageIds = serverMessages.map((m) => m.id);
        const [receiptRows] = await Promise.all([
          fetchMessageReceipts(messageIds),
        ]);

        if (!mountedRef.current || loadId !== loadIdRef.current) {
          return [];
        }

        // actually need the userId for mergeMessages
        const currentMe = meRef.current;
        if (!currentMe) return [];

    const normalized = await decryptMessages(
      serverMessages,
      currentMe.id,
      selectedConversationRef.current?.otherUser.id ?? otherUserId,
      receiptRows,
    );

        setMessages((current) => {
          if (isIncremental) {
            return mergeMessages(current, normalized, currentMe.id);
          }
          if (isLoadMore) {
            const existingIds = new Set(current.map((m) => m.id));
            const deduped = normalized.filter((m) => !existingIds.has(m.id));
            return [...deduped, ...current];
          }
          return normalized;
        });

        if (!isIncremental) {
          setHasMoreMessages(couldHaveMore);
        }

        return normalized;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Не удалось загрузить сообщения";
        throw new Error(message);
      } finally {
        if (!isIncremental && !isLoadMore && mountedRef.current) {
          setMessagesLoading(false);
        }
      }
    },
    [],
  );

  const loadOlderMessages = useCallback(async () => {
    const currentMe = meRef.current;
    const currentConversation = selectedConversationRef.current;
    if (!currentMe || !currentConversation || loadingMore || !hasMoreMessages)
      return;

    setLoadingMore(true);
    try {
      await loadMessages(currentConversation.id, currentConversation.otherUser.id, {
        cursor: oldestSentAtRef.current,
      });
    } catch (error) {
      console.error("Failed to load older messages:", error);
    } finally {
      if (mountedRef.current) {
        setLoadingMore(false);
      }
    }
  }, [loadMessages, loadingMore, hasMoreMessages]);

  const ensureConversation = useCallback(
    async (userId: string, targetId: string) => {
      if (targetId === userId) return null;

      setStartingConversation(true);
      try {
        const result = await (api.rpc as any)("get_or_create_direct_chat", {
          target_user_id: targetId,
        });

        const cleanId = typeof result === "string"
          ? result.replace(/^"|"$/g, "")
          : String(result ?? "");

        updateSearchRef(cleanId, targetId);
        setSelectedConversationId(cleanId);
        setMobileSidebarOpen(false);
        return cleanId;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Не удалось открыть диалог";
        setErrorMessage(message);
        return null;
      } finally {
        if (mountedRef.current) {
          setStartingConversation(false);
        }
      }
    },
    [updateSearchRef],
  );

  const markDelivered = useCallback(
    async (conversationId: string, latestMessageId: string | null) => {
      if (
        !latestMessageId ||
        lastDeliveredMessageIdRef.current === latestMessageId
      ) {
        return;
      }

      try {
        await api.rpc("chat_mark_delivered", {
          target_conversation_id: conversationId,
          target_message_id: latestMessageId,
        });
        lastDeliveredMessageIdRef.current = latestMessageId;
      } catch (error) {
        console.warn("Failed to mark delivered:", error);
      }
    },
    [],
  );

  const markRead = useCallback(
    async (conversationId: string, latestMessageId: string | null) => {
      if (!latestMessageId || lastReadMessageIdRef.current === latestMessageId)
        return;

      try {
        await api.rpc("chat_mark_read", {
          target_conversation_id: conversationId,
          target_message_id: latestMessageId,
        });

        lastReadMessageIdRef.current = latestMessageId;
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  unreadCount: 0,
                  lastReadAt:
                    messagesRef.current.at(-1)?.sent_at ??
                    conversation.lastReadAt,
                }
              : conversation,
          ),
        );
      } catch (error) {
        console.warn("Failed to mark read:", error);
      }
    },
    [],
  );

  const refreshCurrentConversation = useCallback(
    async (incremental = true) => {
      const currentMe = meRef.current;
      const currentConversation = selectedConversationRef.current;
      if (!currentMe || !currentConversation) return;
      await loadMessages(currentConversation.id, currentConversation.otherUser.id, {
        incremental,
      });
    },
    [loadMessages],
  );

  const sendMessage = useCallback(async () => {
    const currentMe = meRef.current;
    const currentConversation = selectedConversationRef.current;
    const currentDraft = draftRef.current;

    if (
      !currentMe ||
      !currentConversation ||
      !currentDraft.trim() ||
      sending
    )
      return;

    if (!currentConversation.otherUser.publicKey) {
      setErrorMessage(
        "У собеседника пока нет messenger-ключа. Он сможет получать сообщения после первого входа в чат.",
      );
      return;
    }

    const plainText = currentDraft.trim();
    const cryptoState = await ensureLocalMessengerState(currentMe.id);
    const clientMessageId = createClientMessageId();
    const localId = `local-${clientMessageId}`;
    const sentAt = new Date().toISOString();

    if (!mountedRef.current) return;

    setSending(true);
    setDraft("");
    setMessages((prev) => [
      ...prev,
      {
        id: localId,
        conversation_id: currentConversation.id,
        sender_user_id: currentMe.id,
        client_message_id: clientMessageId,
        sent_at: sentAt,
        ciphertext: null,
        nonce: null,
        sender_public_key: cryptoState.publicKey,
        recipient_public_key: currentConversation.otherUser.publicKey,
        plainText,
        peerDeliveredAt: null,
        peerReadAt: null,
        localStatus: "pending",
      } as MessageView,
    ]);

    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === currentConversation.id
          ? { ...conv, lastMessageAt: sentAt }
          : conv,
      ),
    );

    try {
      const username = currentConversation.otherUser.username || "";
      const isBot =
        username.startsWith("bot_") || username.endsWith(".bot");

      let ciphertext: string;
      let nonce: string;

      if (isBot) {
        ciphertext = `BOT_PLAINTEXT:${plainText}`;
        nonce = null as unknown as string;
      } else {
        const encrypted = await encryptMessengerText({
          plainText,
          recipientPublicKey: currentConversation.otherUser.publicKey,
          senderPrivateKey: cryptoState.privateKey,
        });
        ciphertext = encrypted.cipherText;
        nonce = encrypted.nonce;
      }

      const { data, error } = await api
        .from("chat_messages" as never)
        .insert({
          conversation_id: currentConversation.id,
          sender_user_id: currentMe.id,
          client_message_id: clientMessageId,
          sender_public_key: cryptoState.publicKey,
          recipient_public_key: currentConversation.otherUser.publicKey,
          ciphertext,
          nonce,
        } as never)
        .select(
          "id, conversation_id, sender_user_id, client_message_id, sent_at, ciphertext, nonce, sender_public_key, recipient_public_key",
        )
        .single();

      if (error || !data) {
        throw error ?? new Error("Не удалось отправить сообщение");
      }

      if (!mountedRef.current) return;

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === localId
            ? {
                ...(data as ChatMessageRecord),
                plainText,
                peerDeliveredAt: null,
                peerReadAt: null,
              }
            : msg,
        ),
      );
      void refreshCurrentConversation(true).catch(() => undefined);
      setErrorMessage(null);
    } catch (error) {
      if (!mountedRef.current) return;
      // Mark as stuck instead of removing — user can retry
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === localId ? { ...msg, localStatus: "pending" as const } : msg,
        ),
      );
      setDraft((prev) => prev || plainText);
      const message =
        error instanceof Error
          ? error.message
          : "Не удалось отправить сообщение";
      setErrorMessage(message);
    } finally {
      if (mountedRef.current) {
        setSending(false);
      }
    }
  }, []);

  // Refs for current draft value (used inside sendMessage callback)
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const onRetryMessage = useCallback(
    async (message: MessageView) => {
      if (sending || !me) return;
      const currentConversation = selectedConversationRef.current;
      if (!currentConversation) return;

      if (!currentConversation.otherUser.publicKey) {
        setErrorMessage(
          "У собеседника пока нет messenger-ключа. Он сможет получать сообщения после первого входа в чат.",
        );
        return;
      }

      // Extract the plainText from the stuck message and resend
      // Reuse the same client_message_id to avoid duplicates on the server
      const plainText = message.plainText;
      const payload = {
        conversation_id: currentConversation.id,
        sender_user_id: me.id,
        client_message_id: message.client_message_id,
        sender_public_key: message.sender_public_key,
        recipient_public_key: message.recipient_public_key,
      };

      const username = currentConversation.otherUser.username || "";
      const isBot = username.startsWith("bot_") || username.endsWith(".bot");

      setSending(true);
      setErrorMessage(null);

      try {
        let ciphertext: string;
        let nonce: string;

        if (isBot) {
          ciphertext = `BOT_PLAINTEXT:${plainText}`;
          nonce = null as unknown as string;
        } else {
          const cryptoState = await ensureLocalMessengerState(me.id);
          const encrypted = await encryptMessengerText({
            plainText,
            recipientPublicKey: currentConversation.otherUser.publicKey,
            senderPrivateKey: cryptoState.privateKey,
          });
          ciphertext = encrypted.cipherText;
          nonce = encrypted.nonce;
        }

        const { data, error } = await api
          .from("chat_messages" as never)
          .insert({ ...payload, ciphertext, nonce } as never)
          .select(
            "id, conversation_id, sender_user_id, client_message_id, sent_at, ciphertext, nonce, sender_public_key, recipient_public_key",
          )
          .single();

        if (error || !data) {
          throw error ?? new Error("Не удалось отправить сообщение");
        }

        if (!mountedRef.current) return;

        // Remove the old stuck message and add the new one
        setMessages((prev) => {
          const filtered = prev.filter(
            (m) => m.client_message_id !== message.client_message_id,
          );
          return [
            ...filtered,
            {
              ...(data as ChatMessageRecord),
              plainText,
              peerDeliveredAt: null,
              peerReadAt: null,
            },
          ].sort(
            (a, b) =>
              new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
          );
        });

        void refreshCurrentConversation(true).catch(() => undefined);
      } catch (error) {
        const msg =
          error instanceof Error
            ? error.message
            : "Не удалось отправить сообщение";
        setErrorMessage(msg);
      } finally {
        if (mountedRef.current) {
          setSending(false);
        }
      }
    },
    [me, sending],
  );

  useEffect(() => {
    resizeComposer();
  }, [draft, resizeComposer]);

  // Bootstrap
  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      try {
        const {
          data: { user },
        } = await api.auth.getUser();

        if (!user) {
          navigate("/auth");
          return;
        }

        if (!mountedRef.current) return;

        await ensureKeyForCurrentUser(user.id);
        const profile = await fetchMyProfile(user.id);

        if (!mountedRef.current) return;

        setMe(profile);

        await loadConversations(user.id);

        if (!targetUserId && mountedRef.current) {
          setMobileSidebarOpen(true);
          setSelectedConversationId(null);
        }
      } catch (error) {
        if (!mountedRef.current) return;
        const message =
          error instanceof Error
            ? error.message
            : "Не удалось инициализировать messenger";
        setErrorMessage(message);
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    };

    void bootstrap();
  }, [loadConversations, navigate, targetUserId]);

  // Handle targetUserId from URL (opening a specific conversation)
  useEffect(() => {
    if (!me || !targetUserId || targetUserId === me.id) return;

    const handleTargetUser = async () => {
      try {
        const existing = conversations.find(
          (conv) => conv.otherUser.id === targetUserId,
        );
        if (existing) {
          setSelectedConversationId(existing.id);
          setMobileSidebarOpen(false);
          updateSearchRef(existing.id, targetUserId);
          return;
        }

        const conversationId = await ensureConversation(me.id, targetUserId);
        if (conversationId) {
          await loadConversations(me.id);
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Не удалось открыть диалог";
        setErrorMessage(message);
      }
    };

    void handleTargetUser();
  }, [conversations, ensureConversation, loadConversations, me, targetUserId, updateSearchRef]);

  // Load messages when conversation changes
  useEffect(() => {
    if (!me || !selectedConversation) {
      setMessages([]);
      return;
    }

    visibleConversationIdRef.current = selectedConversation.id;
    lastReadMessageIdRef.current = null;
    lastDeliveredMessageIdRef.current = null;

    void loadMessages(
      selectedConversation.id,
      selectedConversation.otherUser.id,
      {},
    ).catch((error) => {
      if (mountedRef.current) {
        setErrorMessage(error.message);
      }
    });
  }, [loadMessages, me, selectedConversation]);

  // Sync selectedConversationId when conversations change
  useEffect(() => {
    if (!me) return;
    if (
      selectedConversationId &&
      !conversations.some((c) => c.id === selectedConversationId)
    ) {
      setSelectedConversationId(conversations[0]?.id ?? null);
    }
  }, [conversations, me, selectedConversationId]);

  // Scroll handler
  useEffect(() => {
    const container = messageScrollRef.current;
    if (!container) return;

    const onScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      isNearBottomRef.current = distanceFromBottom <= 64;
    };

    onScroll();
    container.addEventListener("scroll", onScroll);
    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [selectedConversationId]);

  // Auto-scroll on new messages
  useEffect(() => {
    const container = messageScrollRef.current;
    if (!container) return;

    const conversationChanged =
      previousConversationIdRef.current !== selectedConversationId;
    const shouldStickToBottom = conversationChanged || isNearBottomRef.current;

    previousConversationIdRef.current = selectedConversationId;

    if (!shouldStickToBottom) return;

    container.scrollTop = container.scrollHeight;
    endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    isNearBottomRef.current = true;
  }, [messages, selectedConversationId]);

  // Mark delivered/read when messages change
  useEffect(() => {
    if (!me || !selectedConversation || messages.length === 0) return;
    const latestMessage = messages.at(-1);
    if (!latestMessage || latestMessage.localStatus === "pending") return;

    void markDelivered(selectedConversation.id, latestMessage.id).catch(
      () => undefined,
    );

    if (document.visibilityState === "visible") {
      void markRead(selectedConversation.id, latestMessage.id).catch(
        (error) => {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Не удалось отметить диалог прочитанным",
          );
        },
      );
    }
  }, [markDelivered, markRead, me, messages, selectedConversation]);

  // WebSocket subscription
  useEffect(() => {
    if (!selectedConversation) return;

    const chatRoom = `chat_${selectedConversation.id}`;
    ws.subscribe(chatRoom);

    const unsubscribe = ws.on("new_chat_message", () => {
      void refreshCurrentConversation(true).catch(() => undefined);
    });

    return () => {
      unsubscribe();
      ws.unsubscribe(chatRoom);
    };
  }, [refreshCurrentConversation, selectedConversation, ws]);

  // Resolve pinned message content when conversation or messages change
  useEffect(() => {
    if (!selectedConversation?.pinnedMessageId) {
      setPinnedMessageInfo(null);
      return;
    }

    const pinnedId = selectedConversation.pinnedMessageId;
    const found = messages.find((m) => m.id === pinnedId);
    if (found) {
      setPinnedMessageInfo({
        id: found.id,
        plainText: found.plainText,
        sender_user_id: found.sender_user_id,
        sender_username: selectedConversation.otherUser.username,
        sent_at: found.sent_at,
      });
      return;
    }

    // Not found in loaded messages — fetch separately
    const fetchPinnedMessage = async () => {
      try {
        const { data } = await api
          .from("chat_messages" as never)
          .select(
            "id, sender_user_id, ciphertext, nonce, sender_public_key, recipient_public_key, sent_at",
          )
          .eq("id", pinnedId)
          .single();

        if (data && meRef.current) {
          const records = [data] as ChatMessageRecord[];
          const [receipts] = await Promise.all([
            fetchMessageReceipts([data.id as string]),
          ]);
          const decrypted = await decryptMessages(
            records,
            meRef.current.id,
            selectedConversation.otherUser.id,
            receipts,
          );
          if (decrypted.length > 0) {
            setPinnedMessageInfo({
              id: decrypted[0].id,
              plainText: decrypted[0].plainText,
              sender_user_id: decrypted[0].sender_user_id,
              sender_username: selectedConversation.otherUser.username,
              sent_at: decrypted[0].sent_at,
            });
          }
        }
      } catch (err) {
        console.warn("Failed to fetch pinned message:", err);
        setPinnedMessageInfo(null);
      }
    };

    void fetchPinnedMessage();
  }, [selectedConversation?.pinnedMessageId, selectedConversation?.otherUser.id, selectedConversation?.otherUser.username, messages]);

  const onTogglePin = useCallback(
    async (message: MessageView) => {
      const currentConversation = selectedConversationRef.current;
      if (!me || !currentConversation) return;

      try {
        const result = await api.rpc("chat_toggle_pin_message", {
          target_conversation_id: currentConversation.id,
          target_message_id: message.id,
        });

        // Parse response — could be { data: { pinned_message_id: ... } } or similar
        const responseData =
          typeof result === "object" && result !== null
            ? (result as any)?.data ?? result
            : {};
        const newPinnedId: string | null =
          responseData?.pinned_message_id ?? null;

        setConversations((prev) =>
          prev.map((c) =>
            c.id === currentConversation.id
              ? { ...c, pinnedMessageId: newPinnedId }
              : c,
          ),
        );

        // If unpinned, clear the banner immediately
        if (!newPinnedId) {
          setPinnedMessageInfo(null);
        }

        void refreshCurrentConversation(true).catch(() => undefined);
      } catch (error) {
        console.error("Failed to toggle pin:", error);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Не удалось закрепить сообщение",
        );
      }
    },
    [me, refreshCurrentConversation],
  );

  // Focus/visibility handler
  useEffect(() => {
    if (!selectedConversation) return;

    const onFocus = () => {
      if (!mountedRef.current || !visibleConversationIdRef.current) return;
      const latestMessage = messagesRef.current.at(-1);
      if (!latestMessage || latestMessage.localStatus === "pending") return;
      void markRead(
        visibleConversationIdRef.current,
        latestMessage.id,
      ).catch(() => undefined);
      void refreshCurrentConversation(true).catch(() => undefined);
      void loadConversations(meRef.current?.id ?? "", {
        silent: true,
      }).catch(() => undefined);
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [markRead, refreshCurrentConversation, loadConversations, selectedConversation]);

  const onDismissError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const onBackToConversations = useCallback(() => {
    setMobileSidebarOpen(true);
    setSelectedConversationId(null);
    updateSearchRef(null, null);
  }, [updateSearchRef]);

  if (loading || !me) {
    return (
      <MessengerErrorBoundary>
        <div className="messenger-loading-page">
          <PentagramLoader size="lg" />
        </div>
      </MessengerErrorBoundary>
    );
  }

  const totalUnread = conversations.reduce(
    (sum, conversation) => sum + conversation.unreadCount,
    0,
  );

  return (
    <MessengerErrorBoundary>
      <div className="messenger-app">
        <div
          className={`messenger-shell ${shouldShowMobileChat ? "mobile-chat-open" : ""}`}
        >
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
              onDismissError={onDismissError}
            />
          </aside>

          <section
            className={`chat-panel ${shouldShowMobileChat ? "is-open" : ""}`}
          >
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
                onBack={onBackToConversations}
                errorMessage={errorMessage}
                onDismissError={onDismissError}
              />
            ) : (
              <div className="empty-thread hero">
                <MessageCircle size={18} />
                <h2>Выбери диалог</h2>
                <p>
                  Открой переписку слева или начни разговор из профиля любого
                  пользователя.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </MessengerErrorBoundary>
  );
};
