"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, PanelLeft, SendHorizonal } from "lucide-react";
import { getActiveSession, applySessionFromUrlHash, getBrowserSupabase } from "@/lib/browser-supabase";
import { randomClientMessageId } from "@/lib/encoding";
import { PentagramLoader } from "@/components/pentagram-loader";
import {
  buildUploadBundle,
  decryptEnvelope,
  encryptForDevice,
  ensureLocalDeviceState,
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
  };
  devices: DeviceBundle[];
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

type MessageView = ApiMessage & { plainText: string; peerDeliveredAt: string | null; peerReadAt: string | null };

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

const formatPresence = (isOnline: boolean | null, lastSeenAt: string | null) => {
  if (isOnline) return "онлайн";
  if (!lastSeenAt) return "не в сети";
  return `был(а) ${formatDate(lastSeenAt)}`;
};

const getInitials = (username: string) => username.slice(0, 2).toUpperCase();

export const MessengerClient = ({ appBaseUrl, initialTargetUserId, initialConversationId }: Props) => {
  const [sessionReady, setSessionReady] = useState(false);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(true);
  const [targetUserId, setTargetUserId] = useState(initialTargetUserId);
  const [requestedConversationId, setRequestedConversationId] = useState(initialConversationId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const currentAccessTokenRef = useRef<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  const currentDevice = useMemo(() => {
    if (!bootstrap) return null;
    return bootstrap.selfDevices.find((device) => device.clientDeviceId === bootstrap.me.clientDeviceId) ?? null;
  }, [bootstrap]);

  const apiFetch = async (input: string, init?: RequestInit) => {
    const session = await getActiveSession();
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
  };

  const ensureConversation = async () => {
    if (!bootstrap?.target || !targetUserId) return;
    if (conversations.some((conversation) => conversation.otherUser.id === targetUserId)) return;
    if ((bootstrap.target.devices?.length ?? 0) === 0) return;

    setStartingConversation(true);
    try {
      const payload = (await apiFetch("/api/conversations", {
        method: "POST",
        body: JSON.stringify({
          recipientUserId: targetUserId,
        }),
      })) as {
        conversation: { id: string };
      };
      await loadConversations();
      setSelectedConversationId(payload.conversation.id);
      setRequestedConversationId(payload.conversation.id);
      setMobileSidebarOpen(false);
      const url = new URL(window.location.href);
      url.searchParams.set("conversation", payload.conversation.id);
      url.searchParams.set("user", targetUserId);
      window.history.replaceState({}, "", url.toString());
      setErrorMessage(null);
    } finally {
      setStartingConversation(false);
    }
  };

  const loadMessages = async (conversation: Conversation) => {
    if (!currentDevice || !bootstrap) return;
    setMessagesLoading(true);
    try {
      const payload = (await apiFetch(
        `/api/messages/${conversation.id}?deviceId=${encodeURIComponent(currentDevice.id)}`
      )) as { messages: ApiMessage[]; receipts: Receipt[] };
      const decrypted = await Promise.all(
        payload.messages.map(async (message) => {
          try {
            const senderSignalDeviceId =
              bootstrap.selfDevices.find((device) => device.id === message.senderDeviceId)?.signalDeviceId ??
              conversation.devices.find((device) => device.id === message.senderDeviceId)?.signalDeviceId ??
              bootstrap.me.signalDeviceId;
            const peerReceipt =
              payload.receipts.find(
                (receipt) => receipt.message_id === message.id && receipt.user_id === conversation.otherUser.id
              ) ?? null;
            return {
              ...message,
              plainText: await decryptEnvelope(
                bootstrap.me.id,
                message.senderUserId,
                senderSignalDeviceId,
                message.messageType,
                message.ciphertext
              ),
              peerDeliveredAt: peerReceipt?.delivered_at ?? null,
              peerReadAt: peerReceipt?.read_at ?? null,
            };
          } catch {
            return {
              ...message,
              plainText: "[Не удалось расшифровать сообщение на этом устройстве]",
              peerDeliveredAt: null,
              peerReadAt: null,
            };
          }
        })
      );

      setMessages(decrypted);
      const lastMessageId = decrypted.at(-1)?.id;
      if (lastMessageId) {
        await apiFetch(`/api/messages/${conversation.id}/read`, {
          method: "POST",
          body: JSON.stringify({ lastReadMessageId: lastMessageId }),
        });
      }
    } finally {
      setMessagesLoading(false);
    }
  };

  const sendCurrentMessage = async () => {
    if (!draft.trim() || !bootstrap || !selectedConversation || !currentDevice) return;
    setSending(true);
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
          }, draft.trim());
          return {
            recipientUserId: device.userId,
            recipientDeviceId: device.id,
            ciphertext: encrypted.body,
            messageType: encrypted.type,
          };
        })
      );

      await apiFetch("/api/messages", {
        method: "POST",
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          senderDeviceId: currentDevice.id,
          clientMessageId: randomClientMessageId(),
          envelopes,
        }),
      });

      setDraft("");
      await loadConversations();
      await loadMessages(selectedConversation);
      setErrorMessage(null);
    } catch (error) {
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
    if (!sessionReady) return;
    void loadConversations().catch((error) => {
      const message = error instanceof Error ? error.message : "Не удалось загрузить диалоги";
      setErrorMessage(message);
    });
    const accessToken = currentAccessTokenRef.current;
    if (!accessToken) return;
    const source = new EventSource(
      `/api/realtime?accessToken=${encodeURIComponent(accessToken)}${
        selectedConversationId ? `&conversationId=${encodeURIComponent(selectedConversationId)}` : ""
      }`,
      { withCredentials: false }
    );

    const onUpdate = () => {
      void loadConversations().catch((error) => {
        const message = error instanceof Error ? error.message : "Не удалось загрузить диалоги";
        setErrorMessage(message);
      });
      if (selectedConversation) {
        void loadMessages(selectedConversation).catch((error) => {
          const message = error instanceof Error ? error.message : "Не удалось загрузить сообщения";
          setErrorMessage(message);
        });
      }
    };

    source.addEventListener("update", onUpdate);
    source.addEventListener("warning", () => {
      setErrorMessage("Проблема с realtime-обновлением messenger");
    });
    source.onerror = () => {
      source.close();
    };

    return () => {
      source.removeEventListener("update", onUpdate);
      source.close();
    };
  }, [sessionReady, targetUserId, selectedConversationId, selectedConversation]);

  useEffect(() => {
    if (!sessionReady || !bootstrap?.target) return;
    void ensureConversation().catch((error) => {
      const message = error instanceof Error ? error.message : "Не удалось открыть диалог";
      setErrorMessage(message);
    });
  }, [sessionReady, bootstrap?.target?.id, targetUserId, conversations.length]);

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedConversation).catch((error) => {
      const message = error instanceof Error ? error.message : "Не удалось загрузить сообщения";
      setErrorMessage(message);
    });
  }, [selectedConversationId, currentDevice?.id]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

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

      <div className="messenger-shell">
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
            {conversations.length === 0 ? (
              <div className="empty-card">
                <MessageCircle size={18} />
                <p>Пока нет диалогов.</p>
                {bootstrap.target ? (
                  <button type="button" className="cta-button" onClick={() => void ensureConversation()}>
                    {startingConversation ? <PentagramLoader size="sm" /> : `Написать ${bootstrap.target.username}`}
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
                          {conversation.otherUser.username}
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

        <main className="chat-panel">
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
                      style={{ color: selectedConversation.otherUser.usernameColor ?? undefined }}
                    >
                      <strong>{selectedConversation.otherUser.username}</strong>
                    </a>
                    <p className="presence-copy">
                      {formatPresence(selectedConversation.otherUser.isOnline, selectedConversation.otherUser.lastSeenAt)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="message-scroll">
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
                    return (
                      <article key={message.id} className={`bubble-row ${isMine ? "is-mine" : ""}`}>
                        <div className={`message-bubble ${isMine ? "is-mine" : ""}`}>
                          <p>{message.plainText}</p>
                          <div className="message-meta">
                            <time>{formatDate(message.sentAt)}</time>
                            {isMine ? (
                              <span>
                                {message.peerReadAt
                                  ? "прочитано"
                                  : message.peerDeliveredAt
                                    ? "доставлено"
                                    : "отправлено"}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
                <div ref={messageEndRef} />
              </div>

              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendCurrentMessage();
                }}
              >
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Написать сообщение..."
                  rows={1}
                />
                <button type="submit" className="send-button" disabled={sending || !draft.trim()}>
                  {sending ? <PentagramLoader size="sm" /> : <SendHorizonal size={16} />}
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
