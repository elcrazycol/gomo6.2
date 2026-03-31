import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, MessageCircle, SendHorizontal } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { UserBadge } from "@/components/UserBadge";
import { supabase } from "@/integrations/supabase/client";
import {
  createClientMessageId,
  decryptMessengerText,
  encryptMessengerText,
  ensureLocalMessengerState,
} from "@/lib/messengerCrypto";

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
  const deliveryRpcBrokenRef = useRef(false);

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
    const { error } = await supabase.from("chat_user_keys" as never).upsert({
      user_id: userId,
      public_key: cryptoState.publicKey,
    } as never, { onConflict: "user_id" });

    if (error) {
      throw new Error("Не удалось зарегистрировать messenger-ключ");
    }

    return cryptoState;
  };

  const loadConversations = async (userId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setConversationsLoading(true);
    }
    try {
      const { data: membershipRows, error: membershipError } = await supabase
        .from("chat_conversation_members" as never)
        .select("conversation_id, unread_count_cache, last_read_at")
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false });

      if (membershipError) {
        throw membershipError;
      }

      const memberships = ((membershipRows ?? []) as ConversationRow[]);
      const conversationIds = memberships.map((row) => row.conversation_id);
      if (conversationIds.length === 0) {
        setConversations([]);
        setSelectedConversationId(null);
        return [];
      }

      const [{ data: conversationsRows, error: conversationsError }, { data: membersRows, error: membersError }] =
        await Promise.all([
          supabase
            .from("chat_conversations" as never)
            .select("id, last_message_at, updated_at")
            .in("id", conversationIds),
          supabase
            .from("chat_conversation_members" as never)
            .select("conversation_id, user_id")
            .in("conversation_id", conversationIds),
        ]);

      if (conversationsError) {
        throw conversationsError;
      }

      if (membersError) {
        throw membersError;
      }

      const conversationMap = new Map(
        ((conversationsRows ?? []) as ConversationRecord[]).map((row) => [row.id, row])
      );

      const otherUserIds = Array.from(
        new Set(
          ((membersRows ?? []) as ConversationMemberRecord[])
            .filter((row) => row.user_id !== userId)
            .map((row) => row.user_id)
        )
      );

      const [{ data: profileRows, error: profileError }, { data: keyRows, error: keyError }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, username, avatar_url, account_number, is_online, last_seen_at")
          .in("id", otherUserIds),
        supabase
          .from("chat_user_keys" as never)
          .select("user_id, public_key")
          .in("user_id", otherUserIds),
      ]);

      if (profileError) {
        throw profileError;
      }

      if (keyError) {
        throw keyError;
      }

      const profileMap = new Map(
        ((profileRows ?? []) as ProfileSummary[]).map((row) => [row.id, row])
      );
      const keyMap = new Map(
        (((keyRows ?? []) as Array<{ user_id: string; public_key: string }>).map((row) => [row.user_id, row.public_key]))
      );

      const views = memberships
        .map((membership) => {
          const otherMember = ((membersRows ?? []) as ConversationMemberRecord[]).find(
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
          if (message.ciphertext && message.nonce) {
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
              } catch {
                plainText = "[Не удалось расшифровать сообщение]";
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
          return mergeMessages(current, normalized, userId);
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
      const { data, error } = await supabase.rpc("get_or_create_direct_chat" as never, {
        target_user_id: targetId,
      } as never);

      if (error) {
        throw error;
      }

      const conversationId = data as string;
      updateSearch(conversationId, targetId);
      setSelectedConversationId(conversationId);
      setMobileSidebarOpen(false);
      return conversationId;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось открыть диалог";
      throw new Error(message);
    } finally {
      setStartingConversation(false);
    }
  };

  const markDelivered = async (conversationId: string, latestMessageId: string | null) => {
    if (!latestMessageId || deliveryRpcBrokenRef.current || lastDeliveredMessageIdRef.current === latestMessageId) {
      return;
    }

    const { error } = await supabase.rpc("chat_mark_delivered" as never, {
      target_conversation_id: conversationId,
      target_message_id: latestMessageId,
    } as never);

    if (error) {
      deliveryRpcBrokenRef.current = true;
      throw error;
    }

    lastDeliveredMessageIdRef.current = latestMessageId;
  };

  const markRead = async (conversationId: string, latestMessageId: string | null) => {
    if (!latestMessageId || lastReadMessageIdRef.current === latestMessageId) return;

    const { error } = await supabase.rpc("chat_mark_read" as never, {
      target_conversation_id: conversationId,
      target_message_id: latestMessageId,
    } as never);

    if (error) {
      throw error;
    }

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
      const encrypted = await encryptMessengerText({
        plainText,
        recipientPublicKey: selectedConversation.otherUser.publicKey,
        senderPrivateKey: cryptoState.privateKey,
      });

      const { data, error } = await supabase
        .from("chat_messages" as never)
        .insert({
          conversation_id: selectedConversation.id,
          sender_user_id: me.id,
          client_message_id: clientMessageId,
          sender_public_key: cryptoState.publicKey,
          recipient_public_key: selectedConversation.otherUser.publicKey,
          ciphertext: encrypted.cipherText,
          nonce: encrypted.nonce,
        } as never)
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

        if (targetUserId && targetUserId !== user.id) {
          await ensureConversation(user.id, targetUserId);
        }

        const loaded = await loadConversations(user.id);
        if (targetUserId) {
          const targeted = loaded.find((conversation) => conversation.otherUser.id === targetUserId);
          if (targeted) {
            setSelectedConversationId(targeted.id);
            setMobileSidebarOpen(false);
          }
        } else {
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
  }, [navigate, targetUserId]);

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
    container.scrollTop = container.scrollHeight;
    endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
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

  useEffect(() => {
    if (!me) return;

    const channel = supabase.channel(`messenger-web-${me.id}`);

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "chat_conversation_members",
        filter: `user_id=eq.${me.id}`,
      },
      (payload) => {
        const next = payload.new as { conversation_id?: string; unread_count_cache?: number; last_read_at?: string | null } | null;
        if (!next?.conversation_id) return;

        setConversations((current) =>
          current.map((conversation) => {
            if (conversation.id !== next.conversation_id) {
              return conversation;
            }

            const unreadCount = next.unread_count_cache ?? conversation.unreadCount;
            const lastReadAt = next.last_read_at ?? conversation.lastReadAt;

            if (unreadCount === conversation.unreadCount && lastReadAt === conversation.lastReadAt) {
              return conversation;
            }

            return {
              ...conversation,
              unreadCount,
              lastReadAt,
            };
          })
        );

        if (visibleConversationIdRef.current === next.conversation_id) {
          void refreshCurrentConversation(true).catch(() => undefined);
        }
      }
    );

    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
      },
      (payload) => {
        const next = payload.new as { conversation_id?: string; sender_user_id?: string; sent_at?: string | null } | null;
        if (!next?.conversation_id) return;

        setConversations((current) =>
          current
            .map((conversation) =>
              conversation.id === next.conversation_id
                ? {
                    ...conversation,
                    lastMessageAt: next.sent_at ?? conversation.lastMessageAt,
                  }
                : conversation
            )
            .sort((left, right) => {
              const leftTime = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0;
              const rightTime = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0;
              return rightTime - leftTime;
            })
        );

        if (visibleConversationIdRef.current === next.conversation_id) {
          const activeConversation = conversationsRef.current.find((conversation) => conversation.id === next.conversation_id);
          if (activeConversation) {
            void loadMessages(activeConversation, me.id, true).catch(() => undefined);
          } else {
            void loadConversations(me.id, { silent: true }).catch(() => undefined);
          }
        } else {
          void loadConversations(me.id, { silent: true }).catch(() => undefined);
        }
      }
    );

    channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "chat_receipts",
      },
      (payload) => {
        const next = payload.new as ChatReceiptRecord | null;
        if (!next || next.user_id === me.id) return;

        setMessages((current) =>
          current.map((message) => {
            if (message.id !== next.message_id) {
              return message;
            }

            const peerDeliveredAt = next.delivered_at ?? message.peerDeliveredAt;
            const peerReadAt = next.read_at ?? message.peerReadAt;

            if (peerDeliveredAt === message.peerDeliveredAt && peerReadAt === message.peerReadAt) {
              return message;
            }

            return {
              ...message,
              peerDeliveredAt,
              peerReadAt,
            };
          })
        );

        if (visibleConversationIdRef.current) {
          void refreshCurrentConversation(true).catch(() => undefined);
        }
      }
    );

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [me?.id]);

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
                      <img src={conversation.otherUser.avatar_url} alt={conversation.otherUser.username} />
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
                        />
                      </div>
                      <span>{formatDate(conversation.lastMessageAt)}</span>
                    </div>
                    <div className="conversation-meta">
                      <span>#{conversation.otherUser.account_number ?? "?"}</span>
                      <span>{formatPresence(conversation.otherUser.is_online, conversation.otherUser.last_seen_at)}</span>
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
                        src={selectedConversation.otherUser.avatar_url}
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
                  {sending ? <PentagramLoader size="sm" /> : <SendHorizontal size={16} />}
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
