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

type MessageView = ApiMessage & { plainText: string };

type Props = {
  appBaseUrl: string;
  initialTargetUserId: string | null;
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

export const MessengerClient = ({ appBaseUrl, initialTargetUserId }: Props) => {
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
    if (authFromHash?.targetUserId && !targetUserId) {
      setTargetUserId(authFromHash.targetUserId);
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
      `/api/bootstrap${targetUserId ? `?targetUserId=${encodeURIComponent(targetUserId)}` : ""}`,
      {
        method: "POST",
        body: JSON.stringify(uploadBundle),
      }
    )) as BootstrapPayload;

    await updateSignalDeviceAssignment(payload.me.signalDeviceId);
    setBootstrap(payload);
    setSessionReady(true);
  };

  const loadConversations = async () => {
    const payload = (await apiFetch("/api/conversations")) as { conversations: Conversation[] };
    setConversations(payload.conversations);
    setSelectedConversationId((current) => {
      if (current && payload.conversations.some((conversation) => conversation.id === current)) {
        return current;
      }
      const targeted = payload.conversations.find((conversation) => conversation.otherUser.id === targetUserId);
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
      setMobileSidebarOpen(false);
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
      )) as { messages: ApiMessage[] };
      const decrypted = await Promise.all(
        payload.messages.map(async (message) => {
          try {
            const senderSignalDeviceId =
              bootstrap.selfDevices.find((device) => device.id === message.senderDeviceId)?.signalDeviceId ??
              conversation.devices.find((device) => device.id === message.senderDeviceId)?.signalDeviceId ??
              bootstrap.me.signalDeviceId;
            return {
              ...message,
              plainText: await decryptEnvelope(
                bootstrap.me.id,
                message.senderUserId,
                senderSignalDeviceId,
                message.messageType,
                message.ciphertext
              ),
            };
          } catch {
            return {
              ...message,
              plainText: "[Не удалось расшифровать сообщение на этом устройстве]",
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
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await bootstrapMessenger();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    void loadConversations();
    const interval = setInterval(() => void loadConversations(), 5000);
    return () => clearInterval(interval);
  }, [sessionReady, targetUserId]);

  useEffect(() => {
    if (!sessionReady || !bootstrap?.target) return;
    void ensureConversation();
  }, [sessionReady, bootstrap?.target?.id, targetUserId, conversations.length]);

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedConversation);
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
                      setMobileSidebarOpen(false);
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
                            {isMine ? <span>{selectedConversation.lastReadAt ? "прочитано" : "доставлено"}</span> : null}
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
