"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, PanelLeft, SendHorizonal, X } from "lucide-react";
import { getActiveSession, applySessionFromUrlHash, getBrowserSupabase, refreshActiveSession } from "@/lib/browser-supabase";
import { randomClientMessageId } from "@/lib/encoding";
import { PentagramLoader } from "@/components/pentagram-loader";
import {
  buildUploadBundle,
  cacheMessagePlaintext,
  decryptEnvelope,
  encryptForDevice,
  ensureLocalDeviceState,
  getCachedMessagePlaintext,
  getCachedSentPlaintext,
  cacheSentPlaintext,
  resetLocalE2EEState,
  updateSignalDeviceAssignment,
} from "@/lib/signal-store";

type DeviceBundle = {
  id: string;
  userId: string;
  clientDeviceId: string;
  signalDeviceId: number;
  registrationId: number;
  deviceLabel: string;
  identityPublicKey: string;
  signedPreKeyId: number;
  signedPreKeyPublic: string;
  signedPreKeySignature: string;
  kyberPreKeyId: number;
  kyberPreKeyPublic: string;
  kyberPreKeySignature: string;
  oneTimePreKeyId: number | null;
  oneTimePreKeyPublic: string | null;
};

type BootstrapPayload = {
  me: {
    id: string;
    username: string;
    avatarUrl: string | null;
    accountNumber: number | null;
    isOnline: boolean | null;
    lastSeenAt: string | null;
    usernameColor: string | null;
    usernameCss: string | null;
    usernameIconSvg: string | null;
    usernameIconFill: string | null;
    usernameIconStroke: string | null;
    profileBadgeText: string | null;
    profileBadgeCss: string | null;
    clientDeviceId: string;
    signalDeviceId: number;
  };
  selfDevices: DeviceBundle[];
  target: {
    id: string;
    username: string;
    avatarUrl: string | null;
    accountNumber: number | null;
    isOnline: boolean | null;
    lastSeenAt: string | null;
    usernameColor: string | null;
    usernameCss: string | null;
    usernameIconSvg: string | null;
    usernameIconFill: string | null;
    usernameIconStroke: string | null;
    profileBadgeText: string | null;
    profileBadgeCss: string | null;
    devices: DeviceBundle[];
  } | null;
};

type Conversation = {
  id: string;
  kind: string;
  lastMessageAt: string | null;
  unreadCount: number;
  lastReadAt: string | null;
  otherUser: {
    id: string;
    username: string;
    avatarUrl: string | null;
    accountNumber: number | null;
    isOnline: boolean | null;
    lastSeenAt: string | null;
    usernameColor: string | null;
    usernameCss: string | null;
    usernameIconSvg: string | null;
    usernameIconFill: string | null;
    usernameIconStroke: string | null;
    profileBadgeText: string | null;
    profileBadgeCss: string | null;
  };
  devices: DeviceBundle[];
};

type ConversationCreateResponse = {
  conversation: Conversation & {
    recipientUserId: string;
    recipientProfile: Conversation["otherUser"];
    recipientDevices: DeviceBundle[];
  };
};

type ApiMessage = {
  id: string;
  ciphertext: string;
  messageType: number;
  sentAt: string;
  deliveredAt: string | null;
  openedAt: string | null;
  senderUserId: string;
  senderDeviceId: string;
};

type Receipt = {
  message_id: string;
  user_id: string;
  delivered_at: string | null;
  read_at: string | null;
};

type MessageView = ApiMessage & {
  plainText: string;
  peerDeliveredAt: string | null;
  peerReadAt: string | null;
  localStatus?: "pending";
};

type SendMessageResponse = {
  message: {
    id: string;
    sentAt: string;
    selfEnvelope: {
      ciphertext: string;
      messageType: number;
    } | null;
  };
};

type Props = {
  appBaseUrl: string;
  initialTargetUserId: string | null;
  initialConversationId: string | null;
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

const parseCssToStyle = (css: string | null) => {
  const style: Record<string, string> = {};
  if (!css) return style;

  css
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((declaration) => {
      const colonIndex = declaration.indexOf(":");
      if (colonIndex === -1) return;

      const property = declaration.slice(0, colonIndex).trim();
      const value = declaration.slice(colonIndex + 1).trim();
      if (!property || !value) return;

      const reactProperty = property
        .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
        .replace(/^webkit/, "Webkit")
        .replace(/^moz/, "Moz")
        .replace(/^ms/, "Ms");

      style[reactProperty] = value;
    });

  return style;
};

const usernameColorClassMap: Record<string, string> = {
  purple: "var(--messenger-color-purple)",
  gold: "var(--messenger-color-gold)",
  orange: "var(--messenger-color-orange)",
  red: "var(--messenger-color-red)",
  blue: "var(--messenger-color-blue)",
  green: "var(--messenger-color-green)",
  yellow: "var(--messenger-color-yellow)",
  cyan: "var(--messenger-color-cyan)",
};

export const MessengerClient = ({ appBaseUrl, initialTargetUserId, initialConversationId }: Props) => {
  const [sessionReady, setSessionReady] = useState(false);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(true);
  const [targetUserId, setTargetUserId] = useState(initialTargetUserId);
  const [requestedConversationId, setRequestedConversationId] = useState(initialConversationId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recoveringKeys, setRecoveringKeys] = useState(false);
  const [showRecoveryNotice, setShowRecoveryNotice] = useState(true);
  const [recoveryPromptOpen, setRecoveryPromptOpen] = useState(false);
  const [recoveryDismissedMessage, setRecoveryDismissedMessage] = useState<string | null>(null);
  const currentAccessTokenRef = useRef<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedConversationRef = useRef<Conversation | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const messagesRef = useRef<MessageView[]>([]);
  const messageRefreshTimeoutRef = useRef<number | null>(null);
  const lastReadMessageIdRef = useRef<string | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  const currentDevice = useMemo(() => {
    if (!bootstrap) return null;
    return bootstrap.selfDevices.find((device) => device.clientDeviceId === bootstrap.me.clientDeviceId) ?? null;
  }, [bootstrap]);

  const resolveSession = async () => {
    const active = await getActiveSession();
    if (active?.access_token) {
      return active;
    }
    return await refreshActiveSession();
  };

  const apiFetch = async (input: string, init?: RequestInit, allowRetry = true) => {
    const session = await resolveSession();
    const accessToken = session?.access_token ?? null;
    currentAccessTokenRef.current = accessToken;

    const response = await fetch(input, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });

    const payload = await response.json().catch(() => null);
    if (response.status === 401 && allowRetry) {
      const refreshed = await refreshActiveSession();
      currentAccessTokenRef.current = refreshed?.access_token ?? null;
      if (refreshed?.access_token) {
        return await apiFetch(input, init, false);
      }
    }
    if (!response.ok) {
      throw new Error(payload?.error || "Request failed");
    }
    return payload;
  };

  const bootstrapMessenger = async () => {
    const authFromHash = await applySessionFromUrlHash();
    const resolvedTargetUserId = authFromHash?.targetUserId ?? targetUserId ?? initialTargetUserId ?? null;
    const resolvedConversationId =
      authFromHash?.conversationId ?? requestedConversationId ?? initialConversationId ?? null;
    if (resolvedTargetUserId !== targetUserId) {
      setTargetUserId(resolvedTargetUserId);
    }
    if (resolvedConversationId !== requestedConversationId) {
      setRequestedConversationId(resolvedConversationId);
    }

    const session = await getActiveSession();
    if (!session) {
      window.location.assign(`${appBaseUrl}/auth`);
      return;
    }

    const {
      data: { user },
    } = await getBrowserSupabase().auth.getUser();

    if (!user) {
      window.location.assign(`${appBaseUrl}/auth`);
      return;
    }

    const state = await ensureLocalDeviceState(user.id);
    const uploadBundle = buildUploadBundle(state);
    const payload = (await apiFetch(
      `/api/bootstrap${resolvedTargetUserId ? `?targetUserId=${encodeURIComponent(resolvedTargetUserId)}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify(uploadBundle),
      }
    )) as BootstrapPayload;

    await updateSignalDeviceAssignment(payload.me.signalDeviceId);
    setBootstrap(payload);
    setSessionReady(true);
    setErrorMessage(null);
  };

  const loadConversations = async () => {
    setConversationsLoading(true);
    try {
      const payload = (await apiFetch("/api/conversations")) as { conversations: Conversation[] };
      setConversations(payload.conversations);
      setSelectedConversationId((current) => {
        if (requestedConversationId && payload.conversations.some((conversation) => conversation.id === requestedConversationId)) {
          const selected = payload.conversations.find((conversation) => conversation.id === requestedConversationId) ?? null;
          if (selected) {
            const url = new URL(window.location.href);
            url.searchParams.set("conversation", selected.id);
            url.searchParams.set("user", selected.otherUser.id);
            window.history.replaceState({}, "", url.toString());
          }
          return requestedConversationId;
        }
        if (current && payload.conversations.some((conversation) => conversation.id === current)) {
          return current;
        }
        const targeted = payload.conversations.find((conversation) => conversation.otherUser.id === targetUserId);
        if (targeted) {
          const url = new URL(window.location.href);
          url.searchParams.set("user", targeted.otherUser.id);
          url.searchParams.set("conversation", targeted.id);
          window.history.replaceState({}, "", url.toString());
        }
        return targeted?.id ?? payload.conversations[0]?.id ?? null;
      });
      return payload.conversations;
    } finally {
      setConversationsLoading(false);
    }
  };

  const upsertConversationLocally = (conversation: Conversation) => {
    setConversations((current) => {
      const next = current.filter((entry) => entry.id !== conversation.id);
      next.unshift(conversation);
      return next;
    });
  };

  const patchConversation = (conversationId: string, updater: (conversation: Conversation) => Conversation) => {
    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === conversationId);
      if (!existing) return current;

      const updated = updater(existing);
      const next = current.map((conversation) => (conversation.id === conversationId ? updated : conversation));
      next.sort((left, right) => {
        const leftTime = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0;
        const rightTime = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0;
        return rightTime - leftTime;
      });
      return next;
    });
  };

  const isConversationVisible = () => {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return false;
    if (!selectedConversationRef.current) return false;
    if (typeof window === "undefined") return true;
    return window.innerWidth > 980 || !mobileSidebarOpen;
  };

  const markSelectedConversationAsRead = async () => {
    const conversation = selectedConversationRef.current;
    const lastMessage = messagesRef.current.at(-1);
    if (!conversation || !lastMessage || lastReadMessageIdRef.current === lastMessage.id) {
      return;
    }

    lastReadMessageIdRef.current = lastMessage.id;
    patchConversation(conversation.id, (current) => ({
      ...current,
      unreadCount: 0,
      lastReadAt: lastMessage.sentAt,
    }));

    try {
      await apiFetch(`/api/messages/${conversation.id}/read`, {
        method: "POST",
        body: JSON.stringify({ lastReadMessageId: lastMessage.id }),
      });
    } catch (error) {
      lastReadMessageIdRef.current = null;
      const message = error instanceof Error ? error.message : "Не удалось отметить сообщения прочитанными";
      setErrorMessage(message);
    }
  };

  const scheduleMessageRefresh = () => {
    if (messageRefreshTimeoutRef.current !== null) {
      window.clearTimeout(messageRefreshTimeoutRef.current);
    }

    messageRefreshTimeoutRef.current = window.setTimeout(() => {
      messageRefreshTimeoutRef.current = null;
      const conversation = selectedConversationRef.current;
      if (!conversation) return;

      void loadMessages(conversation, { incremental: true }).catch((error) => {
        const message = error instanceof Error ? error.message : "Не удалось загрузить сообщения";
        setErrorMessage(message);
      });
    }, 60);
  };

  const resizeComposer = () => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 140)}px`;
  };

  const ensureConversation = async () => {
    if (!targetUserId || targetUserId === bootstrap?.me.id) return;

    const existingConversation = conversations.find((conversation) => conversation.otherUser.id === targetUserId);
    if (existingConversation) {
      setSelectedConversationId(existingConversation.id);
      setRequestedConversationId(existingConversation.id);
      setMobileSidebarOpen(false);
      const url = new URL(window.location.href);
      url.searchParams.set("conversation", existingConversation.id);
      url.searchParams.set("user", targetUserId);
      window.history.replaceState({}, "", url.toString());
      return;
    }

    setStartingConversation(true);
    try {
      const payload = (await apiFetch("/api/conversations", {
        method: "POST",
        body: JSON.stringify({
          recipientUserId: targetUserId,
        }),
      })) as ConversationCreateResponse;
      upsertConversationLocally(payload.conversation);
      setSelectedConversationId(payload.conversation.id);
      setRequestedConversationId(payload.conversation.id);
      setMobileSidebarOpen(false);
      const url = new URL(window.location.href);
      url.searchParams.set("conversation", payload.conversation.id);
      url.searchParams.set("user", targetUserId);
      window.history.replaceState({}, "", url.toString());
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось открыть диалог";
      setErrorMessage(message);
    } finally {
      setStartingConversation(false);
    }
  };

  const loadMessages = async (conversation: Conversation, options?: { incremental?: boolean }) => {
    if (!currentDevice || !bootstrap) return;
    if (!options?.incremental) {
      setMessagesLoading(true);
    }
    try {
      const payload = (await apiFetch(
        `/api/messages/${conversation.id}?deviceId=${encodeURIComponent(currentDevice.id)}`
      )) as { messages: ApiMessage[]; receipts: Receipt[] };
      const decrypted = await Promise.all(
        payload.messages.map(async (message) => {
          const cachedPlainText = await getCachedMessagePlaintext(message.id);
          const peerReceipt =
            payload.receipts.find(
              (receipt) => receipt.message_id === message.id && receipt.user_id === conversation.otherUser.id
            ) ?? null;

          if (cachedPlainText) {
            return {
              ...message,
              plainText: cachedPlainText,
              peerDeliveredAt: peerReceipt?.delivered_at ?? null,
              peerReadAt: peerReceipt?.read_at ?? null,
            };
          }

          try {
            const senderSignalDeviceId =
              bootstrap.selfDevices.find((device) => device.id === message.senderDeviceId)?.signalDeviceId ??
              conversation.devices.find((device) => device.id === message.senderDeviceId)?.signalDeviceId ??
              bootstrap.me.signalDeviceId;
            const plainText = await decryptEnvelope(
              bootstrap.me.id,
              message.senderUserId,
              senderSignalDeviceId,
              message.messageType,
              message.ciphertext
            );
            await cacheMessagePlaintext(message.id, plainText);
            return {
              ...message,
              plainText,
              peerDeliveredAt: peerReceipt?.delivered_at ?? null,
              peerReadAt: peerReceipt?.read_at ?? null,
            };
          } catch {
            const cachedSentPlainText =
              message.senderUserId === bootstrap.me.id ? await getCachedSentPlaintext(message.ciphertext) : null;
            return {
              ...message,
              plainText: cachedSentPlainText ?? "[Не удалось расшифровать сообщение на этом устройстве]",
              peerDeliveredAt: peerReceipt?.delivered_at ?? null,
              peerReadAt: peerReceipt?.read_at ?? null,
            };
          }
        })
      );

      setMessages((current) => {
        const pendingMessages = current.filter((message) => message.localStatus === "pending");
        const pendingIdsToDrop = new Set<string>();
        const pendingByServerId = new Map<
          string,
          { plainText: string; sentAt: string; peerDeliveredAt: string | null; peerReadAt: string | null }
        >();

        for (const pendingMessage of pendingMessages) {
          const matchedServerMessage = decrypted.find((message) => {
            if (message.senderUserId !== bootstrap.me.id) return false;

            const pendingTime = new Date(pendingMessage.sentAt).getTime();
            const serverTime = new Date(message.sentAt).getTime();
            return Math.abs(serverTime - pendingTime) <= 15000;
          });

          if (matchedServerMessage) {
            pendingIdsToDrop.add(pendingMessage.id);
            pendingByServerId.set(matchedServerMessage.id, {
              plainText: pendingMessage.plainText,
              sentAt: pendingMessage.sentAt,
              peerDeliveredAt: pendingMessage.peerDeliveredAt,
              peerReadAt: pendingMessage.peerReadAt,
            });
          }
        }

        const withoutMatchedPending = current.filter((message) => !pendingIdsToDrop.has(message.id));
        const normalizedDecrypted = decrypted.map((message) => {
          const pendingMatch = pendingByServerId.get(message.id);
          if (!pendingMatch) {
            return message;
          }

          return {
            ...message,
            plainText:
              message.plainText === "[Не удалось расшифровать сообщение на этом устройстве]"
                ? pendingMatch.plainText
                : message.plainText,
            peerDeliveredAt: message.peerDeliveredAt ?? pendingMatch.peerDeliveredAt,
            peerReadAt: message.peerReadAt ?? pendingMatch.peerReadAt,
          };
        });

        if (!options?.incremental) {
          return normalizedDecrypted;
        }

        const merged = new Map(withoutMatchedPending.map((message) => [message.id, message]));
        for (const message of normalizedDecrypted) {
          merged.set(message.id, message);
        }

        return Array.from(merged.values()).sort(
          (left, right) => new Date(left.sentAt).getTime() - new Date(right.sentAt).getTime()
        );
      });
    } finally {
      if (!options?.incremental) {
        setMessagesLoading(false);
      }
    }
  };

  const sendCurrentMessage = async () => {
    if (sending || !draft.trim() || !bootstrap || !selectedConversation || !currentDevice) return;
    if (selectedConversation.devices.length === 0) {
      setErrorMessage("У собеседника пока нет зарегистрированного устройства messenger. Отправка станет доступна после его первого входа.");
      return;
    }
    const plainText = draft.trim();
    const localMessageId = `local-${randomClientMessageId()}`;
    const sentAt = new Date().toISOString();
    setSending(true);
    setMessages((current) => [
      ...current,
      {
        id: localMessageId,
        ciphertext: "",
        messageType: 0,
        sentAt,
        deliveredAt: null,
        openedAt: null,
        senderUserId: bootstrap.me.id,
        senderDeviceId: currentDevice.id,
        plainText,
        peerDeliveredAt: null,
        peerReadAt: null,
        localStatus: "pending",
      },
    ]);
    setDraft("");
    patchConversation(selectedConversation.id, (current) => ({
      ...current,
      lastMessageAt: sentAt,
    }));
    try {
      const allRecipients = [
        ...bootstrap.selfDevices.filter((device) => device.signalDeviceId > 0),
        ...selectedConversation.devices.filter((device) => device.signalDeviceId > 0),
      ];

      const envelopes = await Promise.all(
        allRecipients.map(async (device) => {
          const encrypted = await encryptForDevice(bootstrap.me.id, {
            userId: device.userId,
            signalDeviceId: device.signalDeviceId,
            registrationId: device.registrationId,
            identityPublicKey: device.identityPublicKey,
            signedPreKeyId: device.signedPreKeyId,
            signedPreKeyPublic: device.signedPreKeyPublic,
            signedPreKeySignature: device.signedPreKeySignature,
            oneTimePreKeyId: device.oneTimePreKeyId,
            oneTimePreKeyPublic: device.oneTimePreKeyPublic,
          }, plainText);
          return {
            recipientUserId: device.userId,
            recipientDeviceId: device.id,
            ciphertext: encrypted.body,
            messageType: encrypted.type,
          };
        })
      );

      const selfEnvelope = envelopes.find(
        (entry) => entry.recipientUserId === bootstrap.me.id && entry.recipientDeviceId === currentDevice.id
      );
      if (selfEnvelope) {
        await cacheSentPlaintext(selfEnvelope.ciphertext, plainText);
      }

      const payload = (await apiFetch("/api/messages", {
        method: "POST",
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          senderDeviceId: currentDevice.id,
          clientMessageId: randomClientMessageId(),
          envelopes,
        }),
      })) as SendMessageResponse;

      if (payload.message.selfEnvelope) {
        await cacheMessagePlaintext(payload.message.id, plainText);
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === localMessageId
            ? {
                ...message,
                id: payload.message.id,
                ciphertext: payload.message.selfEnvelope?.ciphertext ?? message.ciphertext,
                messageType: payload.message.selfEnvelope?.messageType ?? message.messageType,
                sentAt: payload.message.sentAt,
                localStatus: undefined,
              }
            : message
        )
      );

      lastReadMessageIdRef.current = payload.message.id;
      if (window.innerWidth <= 980) {
        composerRef.current?.focus({ preventScroll: true });
        window.setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 0);
      }
      setErrorMessage(null);
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== localMessageId));
      setDraft((current) => (current ? current : plainText));
      const message = error instanceof Error ? error.message : "Не удалось отправить сообщение";
      setErrorMessage(message);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await bootstrapMessenger();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось инициализировать messenger";
        setErrorMessage(message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    resizeComposer();
  }, [draft]);

  useEffect(() => {
    if (!sessionReady || !bootstrap) return;
    const supabase = getBrowserSupabase();
    const channel = supabase.channel(`messenger:${bootstrap.me.id}`);

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "chat_conversation_members",
        filter: `user_id=eq.${bootstrap.me.id}`,
      },
      (payload) => {
        const next = payload.new as { conversation_id?: string; unread_count_cache?: number; last_read_at?: string | null } | null;
        if (!next?.conversation_id) return;

        patchConversation(next.conversation_id, (current) => ({
          ...current,
          unreadCount: next.unread_count_cache ?? current.unreadCount,
          lastReadAt: next.last_read_at ?? current.lastReadAt,
        }));
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
        const next = payload.new as {
          id?: string;
          conversation_id?: string;
          sender_user_id?: string;
          sent_at?: string | null;
        } | null;
        if (!next?.conversation_id || !next.sent_at) return;

        patchConversation(next.conversation_id, (current) => ({
          ...current,
          lastMessageAt: next.sent_at ?? current.lastMessageAt,
        }));

        if (
          next.sender_user_id !== bootstrap.me.id &&
          next.conversation_id === selectedConversationRef.current?.id &&
          isConversationVisible()
        ) {
          scheduleMessageRefresh();
        }
      }
    );

    channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "chat_receipts",
        filter: `user_id=eq.${bootstrap.me.id}`,
      },
      (payload) => {
        const next = payload.new as { message_id?: string; delivered_at?: string | null; read_at?: string | null } | null;
        if (!next?.message_id) return;

        setMessages((current) =>
          current.map((message) =>
            message.id === next.message_id
              ? {
                  ...message,
                  peerDeliveredAt: next.delivered_at ?? message.peerDeliveredAt,
                  peerReadAt: next.read_at ?? message.peerReadAt,
                }
              : message
          )
        );
      }
    );

    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        void refreshActiveSession().then((session) => {
          currentAccessTokenRef.current = session?.access_token ?? null;
        });
      }
    });

    return () => {
      if (messageRefreshTimeoutRef.current !== null) {
        window.clearTimeout(messageRefreshTimeoutRef.current);
        messageRefreshTimeoutRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [sessionReady, bootstrap?.me.id]);

  useEffect(() => {
    if (!sessionReady) return;
    void loadConversations().catch((error) => {
      const message = error instanceof Error ? error.message : "Не удалось загрузить диалоги";
      setErrorMessage(message);
    });
  }, [sessionReady, targetUserId]);

  useEffect(() => {
    if (!sessionReady || !targetUserId) return;
    void ensureConversation().catch((error) => {
      const message = error instanceof Error ? error.message : "Не удалось открыть диалог";
      setErrorMessage(message);
    });
  }, [sessionReady, bootstrap?.me.id, targetUserId, conversations.length]);

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([]);
      lastReadMessageIdRef.current = null;
      return;
    }
    lastReadMessageIdRef.current = null;
    void loadMessages(selectedConversation).catch((error) => {
      const message = error instanceof Error ? error.message : "Не удалось загрузить сообщения";
      setErrorMessage(message);
    });
  }, [selectedConversationId, currentDevice?.id]);

  useEffect(() => {
    if (!selectedConversation || messages.length === 0 || !isConversationVisible()) {
      return;
    }

    void markSelectedConversationAsRead();
  }, [messages, selectedConversationId, mobileSidebarOpen]);

  useEffect(() => {
    const handleVisibleRead = () => {
      if (!isConversationVisible() || messagesRef.current.length === 0) return;
      void markSelectedConversationAsRead();
    };

    document.addEventListener("visibilitychange", handleVisibleRead);
    window.addEventListener("focus", handleVisibleRead);
    window.addEventListener("resize", handleVisibleRead);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibleRead);
      window.removeEventListener("focus", handleVisibleRead);
      window.removeEventListener("resize", handleVisibleRead);
    };
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const hasDecryptFailures = messages.some(
    (message) => message.plainText === "[Не удалось расшифровать сообщение на этом устройстве]"
  );

  const handleResetLocalKeys = async () => {
    setRecoveringKeys(true);
    try {
      await resetLocalE2EEState();
      setRecoveryPromptOpen(false);
      setRecoveryDismissedMessage(null);
      window.location.reload();
    } finally {
      setRecoveringKeys(false);
    }
  };

  if (loading || !bootstrap) {
    return (
      <div className="messenger-loading">
        <PentagramLoader />
      </div>
    );
  }

  const totalUnread = conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);

  return (
    <div className="messenger-app">
      <header className="messenger-header">
        <div className="messenger-header-inner">
          <a href={appBaseUrl} className="brand-mark">
            m.gomo6
          </a>
          <div className="header-actions">
            {totalUnread > 0 ? <span className="header-unread-badge">{totalUnread}</span> : null}
            <button
              type="button"
              className="icon-button mobile-only"
              onClick={() => setMobileSidebarOpen((current) => !current)}
              aria-label="Открыть список диалогов"
            >
              <PanelLeft size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className={`messenger-shell ${selectedConversation && !mobileSidebarOpen ? "mobile-chat-open" : ""}`}>
        <aside className={`sidebar-panel ${mobileSidebarOpen ? "is-open" : ""}`}>
          <div className="sidebar-top">
            <div>
              <p className="eyebrow">gomo6 messenger</p>
              <h1>Сообщения</h1>
            </div>
          </div>

          {bootstrap.target && bootstrap.target.devices.length === 0 ? (
            <div className="inline-notice">
              У пользователя пока нет зарегистрированного устройства messenger. Диалог откроется, когда он зайдёт в
              messenger хотя бы один раз.
            </div>
          ) : null}

          {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

          <div className="conversation-list">
            {conversationsLoading ? (
              <div className="panel-loader-overlay sidebar-loader" aria-hidden="true">
                <PentagramLoader size="md" />
              </div>
            ) : null}
            {conversationsLoading && conversations.length === 0 ? (
              <div className="empty-card">
                <PentagramLoader size="md" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="empty-card">
                <MessageCircle size={18} />
                <p>Пока нет диалогов.</p>
                {targetUserId ? (
                  <button type="button" className="cta-button" onClick={() => void ensureConversation()}>
                    {startingConversation ? (
                      <PentagramLoader size="sm" />
                    ) : bootstrap.target ? (
                      `Написать ${bootstrap.target.username}`
                    ) : (
                      "Открыть диалог"
                    )}
                  </button>
                ) : null}
              </div>
            ) : (
              conversations.map((conversation) => {
                const active = conversation.id === selectedConversationId;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    className={`conversation-card ${active ? "is-active" : ""}`}
                    onClick={() => {
                      setSelectedConversationId(conversation.id);
                      setRequestedConversationId(conversation.id);
                      setMobileSidebarOpen(false);
                      const url = new URL(window.location.href);
                      url.searchParams.set("user", conversation.otherUser.id);
                      url.searchParams.set("conversation", conversation.id);
                      window.history.replaceState({}, "", url.toString());
                    }}
                  >
                    <div className="avatar">
                      {conversation.otherUser.avatarUrl ? (
                        <img src={conversation.otherUser.avatarUrl} alt={conversation.otherUser.username} />
                      ) : (
                        <span>{getInitials(conversation.otherUser.username)}</span>
                      )}
                    </div>
                    <div className="conversation-copy">
                      <div className="conversation-head">
                        <strong style={{ color: conversation.otherUser.usernameColor ?? undefined }}>
                          <span
                            className="inline-flex items-center gap-1"
                            style={
                              conversation.otherUser.usernameCss
                                ? parseCssToStyle(conversation.otherUser.usernameCss)
                                : conversation.otherUser.usernameColor
                                  ? { color: usernameColorClassMap[conversation.otherUser.usernameColor] }
                                  : undefined
                            }
                          >
                            <span>{conversation.otherUser.username}</span>
                            {conversation.otherUser.usernameIconSvg ? (
                              <span
                                className="inline-flex items-center justify-center messenger-username-icon"
                                dangerouslySetInnerHTML={{ __html: conversation.otherUser.usernameIconSvg }}
                                style={{
                                  fill: conversation.otherUser.usernameIconFill ?? undefined,
                                  stroke: conversation.otherUser.usernameIconStroke ?? undefined,
                                  width: "1em",
                                  height: "1em",
                                }}
                              />
                            ) : null}
                            {conversation.otherUser.profileBadgeText ? (
                              <span className="messenger-profile-badge" style={parseCssToStyle(conversation.otherUser.profileBadgeCss)}>
                                {conversation.otherUser.profileBadgeText}
                              </span>
                            ) : null}
                          </span>
                        </strong>
                        <span>{formatDate(conversation.lastMessageAt)}</span>
                      </div>
                      <p>End-to-end encrypted</p>
                      <div className="conversation-meta">
                        <span>#{conversation.otherUser.accountNumber ?? "?"}</span>
                        <span>{formatPresence(conversation.otherUser.isOnline, conversation.otherUser.lastSeenAt)}</span>
                        {conversation.unreadCount > 0 ? <span className="count-badge">{conversation.unreadCount}</span> : null}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className={`chat-panel ${selectedConversation && !mobileSidebarOpen ? "is-open" : ""}`}>
          {selectedConversation ? (
            <>
              <div className="chat-topbar">
                <div className="chat-topbar-main">
                  <button
                    type="button"
                    className="icon-button mobile-only"
                    onClick={() => setMobileSidebarOpen(true)}
                    aria-label="Назад к диалогам"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <div className="avatar small">
                    {selectedConversation.otherUser.avatarUrl ? (
                      <img src={selectedConversation.otherUser.avatarUrl} alt={selectedConversation.otherUser.username} />
                    ) : (
                      <span>{getInitials(selectedConversation.otherUser.username)}</span>
                    )}
                  </div>
                  <div>
                    <a
                      href={`${appBaseUrl}/profile/${selectedConversation.otherUser.id}`}
                      className="chat-profile-link"
                    >
                      <strong
                        className="inline-flex items-center gap-1"
                        style={
                          selectedConversation.otherUser.usernameCss
                            ? parseCssToStyle(selectedConversation.otherUser.usernameCss)
                            : selectedConversation.otherUser.usernameColor
                              ? { color: usernameColorClassMap[selectedConversation.otherUser.usernameColor] }
                              : undefined
                        }
                      >
                        <span>{selectedConversation.otherUser.username}</span>
                        {selectedConversation.otherUser.usernameIconSvg ? (
                          <span
                            className="inline-flex items-center justify-center messenger-username-icon"
                            dangerouslySetInnerHTML={{ __html: selectedConversation.otherUser.usernameIconSvg }}
                            style={{
                              fill: selectedConversation.otherUser.usernameIconFill ?? undefined,
                              stroke: selectedConversation.otherUser.usernameIconStroke ?? undefined,
                              width: "1em",
                              height: "1em",
                            }}
                          />
                        ) : null}
                        {selectedConversation.otherUser.profileBadgeText ? (
                          <span className="messenger-profile-badge" style={parseCssToStyle(selectedConversation.otherUser.profileBadgeCss)}>
                            {selectedConversation.otherUser.profileBadgeText}
                          </span>
                        ) : null}
                      </strong>
                    </a>
                    <p className="presence-copy">
                      {formatPresence(selectedConversation.otherUser.isOnline, selectedConversation.otherUser.lastSeenAt)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="message-scroll" onClick={() => composerRef.current?.blur()}>
                {messagesLoading ? (
                  <div className="panel-loader-overlay" aria-hidden="true">
                    <PentagramLoader size="md" />
                  </div>
                ) : null}
                {selectedConversation.devices.length === 0 ? (
                  <div className="inline-notice">
                    Диалог уже создан, но у собеседника пока нет устройства messenger. Как только он впервые откроет
                    messenger, сюда можно будет писать.
                  </div>
                ) : null}
                {hasDecryptFailures && showRecoveryNotice ? (
                  <div className="error-banner">
                    <div className="error-banner-row">
                      <div>
                        <strong>Не удалось расшифровать часть сообщений на этом устройстве.</strong>
                        <p className="error-banner-copy">
                          Можно сбросить локальные ключи и заново инициализировать messenger на этом устройстве.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="icon-button banner-close"
                        onClick={() => {
                          setShowRecoveryNotice(false);
                          setRecoveryDismissedMessage("Подсказка скрыта. Позже этот сброс будет доступен в настройках.");
                        }}
                        aria-label="Закрыть предупреждение"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <button type="button" className="cta-button danger-inline" onClick={() => setRecoveryPromptOpen(true)}>
                      Сбросить локальные ключи
                    </button>
                  </div>
                ) : null}
                {recoveryDismissedMessage ? <div className="inline-notice">{recoveryDismissedMessage}</div> : null}
                {messagesLoading ? (
                  <div className="inline-loader">
                    <PentagramLoader size="md" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="empty-thread">
                    <MessageCircle size={20} />
                    <p>Диалог создан. Все сообщения шифруются на устройстве.</p>
                  </div>
                ) : (
                  messages.map((message) => {
                    const isMine = message.senderUserId === bootstrap.me.id;
                    const statusIcon = isMine
                      ? message.localStatus === "pending"
                        ? ">"
                        : ">>"
                      : null;
                    const statusClassName =
                      isMine && message.peerReadAt
                        ? "message-status is-read"
                        : isMine
                          ? "message-status"
                          : null;
                    return (
                      <article key={message.id} className={`bubble-row ${isMine ? "is-mine" : ""}`}>
                        <div className={`message-bubble ${isMine ? "is-mine" : ""}`}>
                          <p>{message.plainText}</p>
                          <div className="message-meta">
                            <time>{formatTime(message.sentAt)}</time>
                            {statusIcon ? <span className={statusClassName ?? undefined}>{statusIcon}</span> : null}
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
                <div ref={messageEndRef} />
              </div>

              {recoveryPromptOpen ? (
                <div className="confirm-backdrop" role="presentation">
                  <div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="recovery-title">
                    <div className="confirm-card-head">
                      <h2 id="recovery-title">Сбросить локальные ключи?</h2>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setRecoveryPromptOpen(false)}
                        aria-label="Закрыть окно подтверждения"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <p>
                      Это удалит локальные ключи и зашифрованный кэш только на текущем устройстве. После сброса messenger
                      перезагрузится и заново зарегистрирует устройство.
                    </p>
                    <p className="confirm-warning">
                      Старые сообщения на этом устройстве могут остаться недоступными до повторной синхронизации, а
                      незавершённые локальные данные будут потеряны.
                    </p>
                    <div className="confirm-actions">
                      <button type="button" className="cta-button" onClick={() => setRecoveryPromptOpen(false)}>
                        Отмена
                      </button>
                      <button type="button" className="cta-button danger-button" onClick={() => void handleResetLocalKeys()}>
                        {recoveringKeys ? <PentagramLoader size="sm" /> : "Да, сбросить"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <form
                className={`composer ${composerFocused ? "is-focused" : ""}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendCurrentMessage();
                }}
              >
                <textarea
                  ref={composerRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onFocus={() => setComposerFocused(true)}
                  onBlur={() => setComposerFocused(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && window.innerWidth > 980) {
                      event.preventDefault();
                      if (!sending && draft.trim()) {
                        void sendCurrentMessage();
                      }
                    }
                  }}
                  placeholder="Написать сообщение..."
                  rows={1}
                />
                <button
                  type="submit"
                  className="send-button"
                  disabled={sending || !draft.trim()}
                  onMouseDown={(event) => event.preventDefault()}
                  onTouchStart={(event) => event.preventDefault()}
                >
                  <SendHorizonal size={16} />
                </button>
              </form>
            </>
          ) : (
            <div className="empty-thread hero">
              <MessageCircle size={20} />
              <p>Открой диалог из профиля пользователя или выбери переписку слева.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
