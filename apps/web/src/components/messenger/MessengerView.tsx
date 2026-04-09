import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, MessageCircle, SendHorizontal } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { UserBadge } from "@/components/UserBadge";
import { supabase } from "@/integrations/api/client_simple";
import { storageUrl } from "@/utils/storage";
import {
  createClientMessageId,
  decryptMessengerText,
  encryptMessengerText,
  ensureLocalMessengerState,
} from "@/lib/messengerCrypto";
import { useWebSocket } from "@/contexts/WebSocketContext";
import { OnlineStatus } from "@/components/OnlineStatus";

type ProfileSummary = {
  id: string;
  username: string;
  avatar_url: string | null;
  account_number: number | null;
  is_online: boolean | null;
  last_seen_at: string | null;
};

type ConversationRow = {
  conversation_id: string;
  unread_count_cache: number;
  last_read_at: string | null;
};

type ConversationRecord = {
  id: string;
  last_message_at: string | null;
  updated_at: string;
};

type ConversationMemberRecord = {
  conversation_id: string;
  user_id: string;
};

type ChatMessageRecord = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  client_message_id: string;
  sent_at: string;
  ciphertext: string | null;
  nonce: string | null;
  sender_public_key: string | null;
  recipient_public_key: string | null;
};

type ChatReceiptRecord = {
  message_id: string;
  user_id: string;
  delivered_at: string | null;
  read_at: string | null;
};

type ConversationView = {
  id: string;
  unreadCount: number;
  lastReadAt: string | null;
  lastMessageAt: string | null;
  otherUser: ProfileSummary & {
    publicKey: string | null;
  };
};

type MessageView = ChatMessageRecord & {
  plainText: string;
  peerDeliveredAt: string | null;
  peerReadAt: string | null;
  localStatus?: "pending";
};

const mergeMessages = (current: MessageView[], normalized: MessageView[], userId: string) => {
  const pending = current.filter((message) => message.localStatus === "pending");
  const nonPending = current.filter((message) => message.localStatus !== "pending");
  const pendingMatchedIds = new Set<string>();

  const mergedServer = normalized.map((message) => {
    const localPending = pending.find(
      (pendingMessage) =>
        pendingMessage.client_message_id === message.client_message_id && pendingMessage.sender_user_id === userId
    );

    if (!localPending) {
      return message;
    }

    pendingMatchedIds.add(localPending.id);
    return {
      ...message,
      plainText: localPending.plainText,
      peerDeliveredAt: message.peerDeliveredAt ?? localPending.peerDeliveredAt,
      peerReadAt: message.peerReadAt ?? localPending.peerReadAt,
    };
  });

  const pendingStillLocal = pending.filter((message) => !pendingMatchedIds.has(message.id));
  const mergedById = new Map<string, MessageView>();

  for (const message of nonPending) {
    mergedById.set(message.id, message);
  }

  for (const message of mergedServer) {
    mergedById.set(message.id, message);
  }

  const merged = [...pendingStillLocal, ...Array.from(mergedById.values())].sort(
    (left, right) => new Date(left.sent_at).getTime() - new Date(right.sent_at).getTime()
  );

  return merged;
};

const formatDate = (value: string | null) => {
  if (!value) return "сейчас";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const formatTime = (value: string | null) => {
  if (!value) return "сейчас";
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const formatPresence = (isOnline: boolean | null, lastSeenAt: string | null) => {
  if (isOnline) return "онлайн";
  if (!lastSeenAt) return "не в сети";
  return `был(а) ${formatDate(lastSeenAt)}`;
};

const getInitials = (username: string) => username.slice(0, 2).toUpperCase();

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
  const [startingConversation, setStartingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
  const previousConversationIdRef = useRef<string | null>(null);
  const ws = useWebSocket();

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );
  const shouldShowMobileChat = Boolean(selectedConversation) && (!isMobileViewport || !mobileSidebarOpen);

  const openConversation = (conversation: ConversationView) => {
    setSelectedConversationId(conversation.id);
    setMobileSidebarOpen(false);
    updateSearch(conversation.id, conversation.otherUser.id);
  };

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

  useEffect(() => {
    if (!isMobileViewport) return;
    if (targetUserId) return;
    if (requestedConversationId) {
      updateSearch(null, null);
    }
    setSelectedConversationId(null);
    setMobileSidebarOpen(true);
  }, [isMobileViewport, requestedConversationId, targetUserId]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;

    const shouldHideChrome = isMobileViewport && shouldShowMobileChat;
    document.body.classList.toggle("messenger-mobile-chat-active", shouldHideChrome);
    window.dispatchEvent(new CustomEvent("gomo6:messenger-mobile-chat", { detail: shouldHideChrome }));

    return () => {
      document.body.classList.remove("messenger-mobile-chat-active");
      window.dispatchEvent(new CustomEvent("gomo6:messenger-mobile-chat", { detail: false }));
    };
  }, [isMobileViewport, shouldShowMobileChat]);

  const updateSearch = (conversationId: string | null, userId: string | null) => {
    const next = new URLSearchParams(searchParams);
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

    setSearchParams(next, { replace: true });
  };

  const resizeComposer = () => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 140)}px`;
  };

  const fetchMyProfile = async (userId: string) => {
    const { data, error } = await supabase
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
    const { data: existing, error: selectError } = await supabase
      .from("chat_user_keys" as never)
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    // Ignore "multiple rows" error - just means key exists
    if (selectError && selectError.code !== 'PGRST116') {
      console.warn("Error checking existing key:", selectError);
    }

    if (existing) {
      // Key already exists, update it
      const { error } = await supabase
        .from("chat_user_keys" as never)
        .update({
          public_key: cryptoState.publicKey,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("user_id", userId);

      if (error) {
        console.warn("Error updating key:", error);
        // Don't throw - key exists is fine
      }
    } else {
      // Key doesn't exist, insert it
      const { error } = await supabase
        .from("chat_user_keys" as never)
        .insert({
          user_id: userId,
          public_key: cryptoState.publicKey,
        } as never);

      if (error && !error.message?.includes('duplicate key')) {
        throw new Error("Не удалось зарегистрировать messenger-ключ");
      }
      // Ignore duplicate key error - means it was created by another tab
    }

    return cryptoState;
  };

  const loadConversations = async (userId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setConversationsLoading(true);
    }
    try {
      // Get user's conversation memberships using supabase client
      const { data: memberships, error: membershipError } = await supabase
        .from("chat_conversation_members" as never)
        .select("conversation_id,unread_count_cache,last_read_at")
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false });

      if (membershipError) {
        throw new Error("Failed to load conversations");
      }

      const conversationIds = (memberships as ConversationRow[] || []).map((row) => row.conversation_id);

      if (conversationIds.length === 0) {
        setConversations([]);
        setSelectedConversationId(null);
        return [];
      }

      // Get conversations, members, profiles, and keys in parallel using supabase client
      const [conversationsResult, membersResult, profilesResult, keysResult] = await Promise.all([
        supabase
          .from("chat_conversations" as never)
          .select("id,last_message_at,updated_at")
          .in("id", conversationIds),
        supabase
          .from("chat_conversation_members" as never)
          .select("conversation_id,user_id")
          .in("conversation_id", conversationIds),
        supabase
          .from("profiles")
          .select("id,username,avatar_url,account_number,is_online,last_seen_at"),
        supabase
          .from("chat_user_keys" as never)
          .select("user_id,public_key"),
      ]);

      if (conversationsResult.error || membersResult.error || profilesResult.error || keysResult.error) {
        throw new Error("Failed to load conversation data");
      }

      const conversationsRows = (conversationsResult.data || []) as ConversationRecord[];
      const membersRows = (membersResult.data || []) as ConversationMemberRecord[];
      const allProfiles = (profilesResult.data || []) as ProfileSummary[];
      const allKeys = (keysResult.data || []) as Array<{ user_id: string; public_key: string }>;

      const conversationMap = new Map(conversationsRows.map((row) => [row.id, row]));

      const otherUserIds = Array.from(
        new Set(
          membersRows
            .filter((row) => row.user_id !== userId)
            .map((row) => row.user_id)
        )
      );

      const profileMap = new Map(
        allProfiles.filter(p => otherUserIds.includes(p.id)).map((row) => [row.id, row])
      );
      const keyMap = new Map(
        allKeys.filter(k => otherUserIds.includes(k.user_id)).map((row) => [row.user_id, row.public_key])
      );

      const views = (memberships as ConversationRow[] || [])
        .map((membership) => {
          const otherMember = membersRows.find(
            (row) => row.conversation_id === membership.conversation_id && row.user_id !== userId
          );
          if (!otherMember) {
            return null;
          }

          const profile = profileMap.get(otherMember.user_id);
          if (!profile) {
            return null;
          }

          const conversation = conversationMap.get(membership.conversation_id);
          if (!conversation) {
            return null;
          }

          return {
            id: membership.conversation_id,
            unreadCount: membership.unread_count_cache ?? 0,
            lastReadAt: membership.last_read_at,
            lastMessageAt: conversation.last_message_at,
            otherUser: {
              ...profile,
              publicKey: keyMap.get(profile.id) ?? null,
            },
          } satisfies ConversationView;
        })
        .filter((value): value is ConversationView => value !== null)
        .sort((left, right) => {
          const leftTime = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0;
          const rightTime = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0;
          return rightTime - leftTime;
        });

      setConversations(views);
      setSelectedConversationId((current) => {
        if (targetUserId) {
          return views.find((conversation) => conversation.otherUser.id === targetUserId)?.id ?? current ?? null;
        }

        if (current && views.some((conversation) => conversation.id === current)) {
          return current;
        }

        if (!isMobileViewport && requestedConversationId && views.some((conversation) => conversation.id === requestedConversationId)) {
          return requestedConversationId;
        }

        if (!isMobileViewport) {
          return views[0]?.id ?? null;
        }

        return null;
      });

      return views;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить диалоги";
      throw new Error(message);
    } finally {
      if (!options?.silent) {
        setConversationsLoading(false);
      }
    }
  };

  const loadMessages = async (conversation: ConversationView, userId: string, incremental = false) => {
    if (!incremental) {
      setMessagesLoading(true);
    }

    try {
      const { data: messageRows, error: messageError } = await supabase
        .from("chat_messages" as never)
        .select("id, conversation_id, sender_user_id, client_message_id, sent_at, ciphertext, nonce, sender_public_key, recipient_public_key")
        .eq("conversation_id", conversation.id)
        .order("sent_at", { ascending: true });

      if (messageError) {
        throw messageError;
      }

      const serverMessages = (messageRows ?? []) as ChatMessageRecord[];
      const messageIds = serverMessages.map((message) => message.id);
      const { data: receiptRows, error: receiptError } = await supabase
        .from("chat_receipts" as never)
        .select("message_id, user_id, delivered_at, read_at")
        .in("message_id", messageIds.length > 0 ? messageIds : ["00000000-0000-0000-0000-000000000000"]);

      if (receiptError) {
        throw receiptError;
      }

      const myCrypto = await ensureLocalMessengerState(userId);
      const normalized = await Promise.all(
        serverMessages.map(async (message) => {
          const peerReceipt =
            ((receiptRows ?? []) as ChatReceiptRecord[]).find(
              (receipt) => receipt.message_id === message.id && receipt.user_id === conversation.otherUser.id
            ) ?? null;

          let plainText = "[Не удалось расшифровать сообщение]";
          if (message.ciphertext) {
            // Check if message is from bot (BOT_PLAINTEXT format)
            if (message.ciphertext.startsWith('BOT_PLAINTEXT:')) {
              plainText = message.ciphertext.substring('BOT_PLAINTEXT:'.length);
            } else if (message.nonce) {
              const peerPublicKey =
                message.sender_user_id === userId ? message.recipient_public_key : message.sender_public_key;

              if (peerPublicKey) {
                try {
                  plainText = await decryptMessengerText({
                    cipherText: message.ciphertext,
                    nonce: message.nonce,
                    peerPublicKey,
                    myPrivateKey: myCrypto.privateKey,
                  });
                } catch (err) {
                  console.error('Decryption error:', err);
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
        })
      );

      setMessages((current) => {
        if (!incremental) {
          return normalized;
        }
        return mergeMessages(current, normalized, userId);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить сообщения";
      throw new Error(message);
    } finally {
      if (!incremental) {
        setMessagesLoading(false);
      }
    }
  };

  const ensureConversation = async (userId: string, targetId: string) => {
    if (targetId === userId) return null;

    setStartingConversation(true);
    try {
      const result = await supabase.rpc("get_or_create_direct_chat", {
        target_user_id: targetId,
      });

      const cleanId = typeof result === 'string' ? result.replace(/^"|"$/g, '') : result;

      updateSearch(cleanId, targetId);
      setSelectedConversationId(cleanId);
      setMobileSidebarOpen(false);
      return cleanId;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось открыть диалог";
      setErrorMessage(message);
      return null;
    } finally {
      setStartingConversation(false);
    }
  };

  const markDelivered = async (conversationId: string, latestMessageId: string | null) => {
    if (!latestMessageId || lastDeliveredMessageIdRef.current === latestMessageId) {
      return;
    }

    try {
      await supabase.rpc("chat_mark_delivered", {
        target_conversation_id: conversationId,
        target_message_id: latestMessageId,
      });
      lastDeliveredMessageIdRef.current = latestMessageId;
    } catch (error) {
      // Silently fail delivery marking
      console.warn("Failed to mark delivered:", error);
    }
  };

  const markRead = async (conversationId: string, latestMessageId: string | null) => {
    if (!latestMessageId || lastReadMessageIdRef.current === latestMessageId) return;

    try {
      await supabase.rpc("chat_mark_read", {
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
                lastReadAt: messagesRef.current.at(-1)?.sent_at ?? conversation.lastReadAt,
              }
            : conversation
        )
      );
    } catch (error) {
      console.warn("Failed to mark read:", error);
    }
  };

  const refreshCurrentConversation = async (incremental = true) => {
    const currentMe = meRef.current;
    const currentConversation = selectedConversationRef.current;
    if (!currentMe || !currentConversation) return;
    await loadMessages(currentConversation, currentMe.id, incremental);
  };

  const sendMessage = async () => {
    if (!me || !selectedConversation || !draft.trim() || sending) return;
    if (!selectedConversation.otherUser.publicKey) {
      setErrorMessage("У собеседника пока нет messenger-ключа. Он сможет получать сообщения после первого входа в чат.");
      return;
    }

    const plainText = draft.trim();
    const cryptoState = await ensureLocalMessengerState(me.id);
    const clientMessageId = createClientMessageId();
    const localId = `local-${clientMessageId}`;
    const sentAt = new Date().toISOString();

    setSending(true);
    setDraft("");
    setMessages((current) => [
      ...current,
      {
        id: localId,
        conversation_id: selectedConversation.id,
        sender_user_id: me.id,
        client_message_id: clientMessageId,
        sent_at: sentAt,
        ciphertext: null,
        nonce: null,
        sender_public_key: cryptoState.publicKey,
        recipient_public_key: selectedConversation.otherUser.publicKey,
        plainText,
        peerDeliveredAt: null,
        peerReadAt: null,
        localStatus: "pending",
      },
    ]);

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === selectedConversation.id
          ? {
              ...conversation,
              lastMessageAt: sentAt,
            }
          : conversation
      )
    );

    try {
      // Check if recipient is a bot by checking username pattern
      const username = selectedConversation.otherUser.username || '';
      const isBot = username.startsWith('bot_') || username.endsWith('.bot');

      let ciphertext: string;
      let nonce: string;

      if (isBot) {
        // For bots, use BOT_PLAINTEXT: prefix instead of encryption
        ciphertext = `BOT_PLAINTEXT:${plainText}`;
        nonce = null as any; // null for bot messages
      } else {
        // For regular users, encrypt normally
        const encrypted = await encryptMessengerText({
          plainText,
          recipientPublicKey: selectedConversation.otherUser.publicKey,
          senderPrivateKey: cryptoState.privateKey,
        });
        ciphertext = encrypted.cipherText;
        nonce = encrypted.nonce;
      }

      const insertPayload = {
        conversation_id: selectedConversation.id,
        sender_user_id: me.id,
        client_message_id: clientMessageId,
        sender_public_key: cryptoState.publicKey,
        recipient_public_key: selectedConversation.otherUser.publicKey,
        ciphertext,
        nonce,
      };

      const { data, error } = await supabase
        .from("chat_messages" as never)
        .insert(insertPayload as never)
        .select("id, conversation_id, sender_user_id, client_message_id, sent_at, ciphertext, nonce, sender_public_key, recipient_public_key")
        .single();

      if (error || !data) {
        throw error ?? new Error("Не удалось отправить сообщение");
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === localId
            ? {
                ...(data as ChatMessageRecord),
                plainText,
                peerDeliveredAt: null,
                peerReadAt: null,
              }
            : message
        )
      );
      void refreshCurrentConversation(true).catch(() => undefined);
      setErrorMessage(null);
      updateSearch(selectedConversation.id, selectedConversation.otherUser.id);
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== localId));
      setDraft((current) => current || plainText);
      const message = error instanceof Error ? error.message : "Не удалось отправить сообщение";
      setErrorMessage(message);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    resizeComposer();
  }, [draft]);

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          navigate("/auth");
          return;
        }

        await ensureKeyForCurrentUser(user.id);
        const profile = await fetchMyProfile(user.id);
        setMe(profile);

        const loaded = await loadConversations(user.id);
        if (!targetUserId) {
          setMobileSidebarOpen(true);
          setSelectedConversationId(null);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось инициализировать messenger";
        setErrorMessage(message);
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();
  }, [navigate]);

  useEffect(() => {
    if (!me || !targetUserId || targetUserId === me.id) return;

    const handleTargetUser = async () => {
      try {
        // Check if conversation already exists
        const existing = conversations.find((conv) => conv.otherUser.id === targetUserId);
        if (existing) {
          setSelectedConversationId(existing.id);
          setMobileSidebarOpen(false);
          updateSearch(existing.id, targetUserId);
          return;
        }

        // Create new conversation
        const conversationId = await ensureConversation(me.id, targetUserId);
        if (conversationId) {
          await loadConversations(me.id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось открыть диалог";
        setErrorMessage(message);
      }
    };

    void handleTargetUser();
  }, [me?.id, targetUserId, conversations]);

  useEffect(() => {
    if (!me || !selectedConversation) {
      setMessages([]);
      return;
    }

    visibleConversationIdRef.current = selectedConversation.id;
    lastReadMessageIdRef.current = null;
    lastDeliveredMessageIdRef.current = null;

    void loadMessages(selectedConversation, me.id).catch((error) => {
      setErrorMessage(error.message);
    });
  }, [me?.id, selectedConversationId]);

  useEffect(() => {
    if (!me) return;
    if (selectedConversationId && !conversations.some((conversation) => conversation.id === selectedConversationId)) {
      setSelectedConversationId(conversations[0]?.id ?? null);
    }
  }, [conversations, me?.id, selectedConversationId]);

  useEffect(() => {
    const container = messageScrollRef.current;
    if (!container) return;

    const onScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      isNearBottomRef.current = distanceFromBottom <= 64;
    };

    onScroll();
    container.addEventListener("scroll", onScroll);

    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [selectedConversationId]);

  useEffect(() => {
    const container = messageScrollRef.current;
    if (!container) return;

    const conversationChanged = previousConversationIdRef.current !== selectedConversationId;
    const shouldStickToBottom = conversationChanged || isNearBottomRef.current;

    previousConversationIdRef.current = selectedConversationId;

    if (!shouldStickToBottom) return;

    container.scrollTop = container.scrollHeight;
    endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    isNearBottomRef.current = true;
  }, [messages, selectedConversationId]);

  useEffect(() => {
    if (!me || !selectedConversation || messages.length === 0) return;
    const latestMessage = messages.at(-1);
    if (!latestMessage || latestMessage.localStatus === "pending") return;

    void markDelivered(selectedConversation.id, latestMessage.id).catch(() => undefined);

    if (document.visibilityState === "visible") {
      void markRead(selectedConversation.id, latestMessage.id).catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Не удалось отметить диалог прочитанным");
      });
    }
  }, [me?.id, selectedConversation?.id, messages]);

  // Subscribe to WebSocket updates for current conversation
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
  }, [selectedConversation?.id, ws]);

  useEffect(() => {
    if (!selectedConversation) return;

    const onFocus = () => {
      const latestMessage = messagesRef.current.at(-1);
      if (!latestMessage || latestMessage.localStatus === "pending") return;
      void markRead(selectedConversation.id, latestMessage.id).catch(() => undefined);
      void refreshCurrentConversation(true).catch(() => undefined);
      void loadConversations(me.id, { silent: true }).catch(() => undefined);
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [messages, selectedConversation?.id]);

  if (loading || !me) {
    return (
      <div className="messenger-loading-page">
        <PentagramLoader size="lg" />
      </div>
    );
  }
  const totalUnread = conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);

  return (
    <div className="messenger-app">
      <div className={`messenger-shell ${shouldShowMobileChat ? "mobile-chat-open" : ""}`}>
        <aside className={`sidebar-panel ${mobileSidebarOpen ? "is-open" : ""}`}>
          <div className="sidebar-top">
            <div>
              <h1>Сообщения</h1>
            </div>
            {totalUnread > 0 ? <span className="header-unread-badge">{totalUnread}</span> : null}
          </div>

          {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

          <div className="conversation-list">
            {conversationsLoading && conversations.length === 0 ? (
              <div className="panel-loader-overlay sidebar-loader">
                <PentagramLoader size="md" />
              </div>
            ) : null}

            {conversations.length === 0 ? (
              <div className="empty-card">
                <MessageCircle size={18} />
                <p>Диалогов пока нет.</p>
                {targetUserId ? (
                  <button
                    type="button"
                    className="cta-button"
                    onClick={() => void ensureConversation(me.id, targetUserId).then(() => loadConversations(me.id))}
                  >
                    {startingConversation ? <PentagramLoader size="sm" /> : "Открыть диалог"}
                  </button>
                ) : null}
              </div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`conversation-card ${conversation.id === selectedConversationId ? "is-active" : ""}`}
                  onClick={() => openConversation(conversation)}
                >
                  <div className="avatar">
                    {conversation.otherUser.avatar_url ? (
                      <img
                        src={storageUrl("post-images", conversation.otherUser.avatar_url) || undefined}
                        alt={conversation.otherUser.username}
                      />
                    ) : (
                      <span>{getInitials(conversation.otherUser.username)}</span>
                    )}
                  </div>
                  <div className="conversation-copy">
                    <div className="conversation-head">
                      <div className="conversation-user-badge">
                        <UserBadge
                          userId={conversation.otherUser.id}
                          username={conversation.otherUser.username}
                          showOutline={false}
                          disableLink
                          disableHoverCard
                        />
                      </div>
                    </div>
                    <div className="conversation-meta">
                      <span>{formatDate(conversation.lastMessageAt)}</span>
                      <span>#{conversation.otherUser.account_number ?? "?"}</span>
                      <OnlineStatus
                        isOnline={conversation.otherUser.is_online}
                        lastSeen={conversation.otherUser.last_seen_at}
                        showText={false}
                      />
                      {conversation.unreadCount > 0 ? <span className="count-badge">{conversation.unreadCount}</span> : null}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className={`chat-panel ${shouldShowMobileChat ? "is-open" : ""}`}>
          {selectedConversation ? (
            <>
              <div className="chat-topbar">
                <div className="chat-topbar-main">
                  <button
                    type="button"
                    className="icon-button mobile-only messenger-back-button"
                    onClick={() => {
                      setMobileSidebarOpen(true);
                      setSelectedConversationId(null);
                      updateSearch(null, null);
                    }}
                    aria-label="Назад к диалогам"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <div className="avatar small">
                    {selectedConversation.otherUser.avatar_url ? (
                      <img
                        src={storageUrl("post-images", selectedConversation.otherUser.avatar_url) || undefined}
                        alt={selectedConversation.otherUser.username}
                      />
                    ) : (
                      <span>{getInitials(selectedConversation.otherUser.username)}</span>
                    )}
                  </div>
                  <div>
                    <div className="chat-user-badge">
                      <UserBadge
                        userId={selectedConversation.otherUser.id}
                        username={selectedConversation.otherUser.username}
                        showOutline={false}
                      />
                    </div>
                    <p className="presence-copy">
                      {formatPresence(selectedConversation.otherUser.is_online, selectedConversation.otherUser.last_seen_at)}
                    </p>
                  </div>
                </div>
              </div>

              <div ref={messageScrollRef} className="message-scroll">
                {messagesLoading ? (
                  <div className="inline-loader">
                    <PentagramLoader size="md" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="empty-thread hero">
                    <MessageCircle size={18} />
                    <h2>Диалог готов</h2>
                    <p>Напиши первое сообщение, и переписка начнётся сразу.</p>
                  </div>
                ) : (
                  messages.map((message) => {
                    const isMine = message.sender_user_id === me.id;
                    return (
                      <div key={message.id} className={`bubble-row ${isMine ? "is-mine" : ""}`}>
                        <div className={`message-bubble ${isMine ? "is-mine" : ""}`}>
                          <p>{message.plainText}</p>
                          <div className="message-meta">
                            <span>{formatTime(message.sent_at)}</span>
                            {isMine ? (
                              <span className={`message-status ${message.peerReadAt ? "is-read" : ""}`}>
                                {message.localStatus === "pending" ? ">" : message.peerReadAt ? ">>" : message.peerDeliveredAt ? ">>" : ">"}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>

              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendMessage();
                }}
              >
                <textarea
                  ref={composerRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="Напиши сообщение..."
                />
                <button type="submit" className="send-button" disabled={sending || !draft.trim()}>
                  <SendHorizontal size={16} />
                </button>
              </form>
            </>
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
  );
};
