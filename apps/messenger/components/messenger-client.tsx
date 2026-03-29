"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, PanelLeft, SendHorizonal } from "lucide-react";
import { PentagramLoader } from "@/components/pentagram-loader";
import {
  clearLegacyMessengerStorage,
  createConversationKey,
  decryptConversationKey,
  decryptMessage,
  encryptConversationKeyForParticipant,
  encryptMessage,
  getOrCreateDeviceKeys,
} from "@/lib/crypto";

type BootstrapPayload = {
  me: {
    id: string;
    mainUserId: string;
    username: string;
    avatarUrl: string | null;
    deviceId: string;
    publicKey: string;
  };
  target: {
    id: string;
    mainUserId: string;
    username: string;
    avatarUrl: string | null;
    devices: Array<{
      deviceId: string;
      label: string;
      publicKey: string;
    }>;
  } | null;
};

type Conversation = {
  id: string;
  createdAt: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  lastReadAt: string | null;
  keychain: Array<{
    deviceId: string;
    encryptedKey: string;
  }>;
  otherUser: {
    id: string;
    mainUserId: string;
    username: string;
    accountNumber: number | null;
    avatarUrl: string | null;
  } | null;
};

type ApiMessage = {
  id: string;
  ciphertext: string;
  nonce: string;
  sentAt: string;
  deliveredAt: string | null;
  senderDeviceId: string;
  senderMainUserId: string;
};

type MessageView = ApiMessage & {
  plainText: string;
  optimistic?: boolean;
};

type Props = {
  username: string;
  targetUserId: string | null;
  appBaseUrl: string;
};

const formatDate = (value: string | null) => {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const formatRelativeMeta = (value: string | null) => {
  if (!value) return "Пусто";
  return formatDate(value);
};

const initialsFrom = (username: string) => username.slice(0, 2).toUpperCase();
const reportMessengerError = (context: string, error: unknown) => {
  console.error(`[messenger] ${context}`, error);
};
const buildConversationListSignature = (conversations: Conversation[]) =>
  JSON.stringify(
    conversations.map((conversation) => ({
      id: conversation.id,
      lastMessageAt: conversation.lastMessageAt,
      lastReadAt: conversation.lastReadAt,
      unreadCount: conversation.unreadCount,
      otherUserId: conversation.otherUser?.id ?? null,
    }))
  );
const buildConversationMessagesSignature = (conversation: Conversation | null) =>
  conversation
    ? JSON.stringify({
        id: conversation.id,
        keychain: conversation.keychain.map((entry) => `${entry.deviceId}:${entry.encryptedKey}`),
      })
    : null;

export const MessengerClient = ({ username, targetUserId, appBaseUrl }: Props) => {
  const autoCreatedTargetRef = useRef<string | null>(null);
  const attemptedTargetRef = useRef<string | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const messageLoadRequestRef = useRef(0);
  const latestActiveMessageIdRef = useRef<string | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const conversationListSignatureRef = useRef("");
  const lastRealtimeSnapshotRef = useRef("");
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
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const realtimeReloadRef = useRef(false);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );
  const mobileChatOpen = !mobileSidebarOpen && !!selectedConversation;
  const totalUnreadCount = conversations.reduce((sum, conversation) => sum + Math.max(0, conversation.unreadCount), 0);
  const selectedConversationLoadSignature = useMemo(
    () => buildConversationMessagesSignature(selectedConversation),
    [selectedConversation]
  );

  const selectedKeyEntry = useMemo(() => {
    if (!selectedConversation || !bootstrap) return null;
    return selectedConversation.keychain.find((entry) => entry.deviceId === bootstrap.me.deviceId) ?? null;
  }, [bootstrap, selectedConversation]);

  const loadBootstrap = async () => {
    const keys = await getOrCreateDeviceKeys();
    const response = await fetch(
      `/api/bootstrap${targetUserId ? `?targetUserId=${encodeURIComponent(targetUserId)}` : ""}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          publicKey: keys.publicKey,
          deviceId: keys.deviceId,
          deviceLabel: "browser",
        }),
      }
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || "Не удалось подготовить устройство");
    }

    return payload as BootstrapPayload;
  };

  const loadConversations = async () => {
    const response = await fetch("/api/conversations", {
      credentials: "include",
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || "Не удалось загрузить переписки");
    }

    const nextConversations = (payload?.conversations ?? []) as Conversation[];
    const nextSignature = buildConversationListSignature(nextConversations);
    if (nextSignature !== conversationListSignatureRef.current) {
      conversationListSignatureRef.current = nextSignature;
      setConversations(nextConversations);
    }
    setConversationsLoaded(true);
    setSelectedConversationId((current) => {
      if (current && nextConversations.some((conversation) => conversation.id === current)) {
        return current;
      }

      const autoCreated = nextConversations.find(
        (conversation) => conversation.otherUser?.mainUserId === autoCreatedTargetRef.current
      );
      const readable = nextConversations.find(
        (conversation) => conversation.keychain.some((entry) => entry.deviceId === bootstrap?.me.deviceId)
      );
      return autoCreated?.id ?? readable?.id ?? nextConversations[0]?.id ?? null;
    });

    return nextConversations;
  };

  const loadMessages = async (conversation: Conversation, options?: { showLoader?: boolean }) => {
    const requestId = ++messageLoadRequestRef.current;
    if (options?.showLoader !== false) {
      setMessagesLoading(true);
    }
    try {
      const keys = await getOrCreateDeviceKeys();
      const keyEntry = conversation.keychain.find((entry) => entry.deviceId === keys.deviceId);
      if (!keyEntry) {
        if (requestId === messageLoadRequestRef.current) {
          setMessages([]);
        }
        reportMessengerError("missing_conversation_key", { conversationId: conversation.id });
        return;
      }

      const conversationKey = await decryptConversationKey(keyEntry.encryptedKey, keys).catch(() => {
        if (requestId === messageLoadRequestRef.current) {
          setMessages([]);
        }
        reportMessengerError("invalid_conversation_key", { conversationId: conversation.id });
        return null;
      });
      if (!conversationKey) {
        return;
      }
      const response = await fetch(`/api/messages/${conversation.id}`, {
        credentials: "include",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось загрузить сообщения");
      }

      const decrypted = await Promise.all(
        ((payload?.messages ?? []) as ApiMessage[]).map(async (message) => {
          try {
            return {
              ...message,
              plainText: await decryptMessage(message.ciphertext, message.nonce, conversationKey),
            };
          } catch {
            return {
              ...message,
              plainText: "[Не удалось расшифровать сообщение на этом устройстве]",
            };
          }
        })
      );

      if (requestId !== messageLoadRequestRef.current || selectedConversationIdRef.current !== conversation.id) {
        return;
      }

      setMessages(decrypted);
      latestActiveMessageIdRef.current = decrypted.at(-1)?.id ?? null;

      const readResponse = await fetch(`/api/messages/${conversation.id}/read`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lastReadMessageId: decrypted.at(-1)?.id ?? null,
        }),
      });
      if (!readResponse.ok) {
        const readPayload = await readResponse.json().catch(() => null);
        throw new Error(readPayload?.error || "Не удалось обновить статус прочтения");
      }
    } finally {
      if (requestId === messageLoadRequestRef.current && options?.showLoader !== false) {
        setMessagesLoading(false);
      }
    }
  };

  const startConversation = async () => {
    if (!bootstrap?.target) return;
    if (bootstrap.target.mainUserId === bootstrap.me.mainUserId) {
      reportMessengerError("self_conversation_blocked", { userId: bootstrap.me.mainUserId });
      return;
    }
    if (bootstrap.target.devices.length === 0) {
      reportMessengerError("target_has_no_devices", { targetUserId: bootstrap.target.mainUserId });
      return;
    }

    setStartingConversation(true);

    try {
      const deviceKeys = await getOrCreateDeviceKeys();
      const conversationKey = createConversationKey();
      const keychain = await Promise.all([
        Promise.resolve({
          userId: bootstrap.me.id,
          deviceId: deviceKeys.deviceId,
          encryptedKey: await encryptConversationKeyForParticipant(conversationKey, deviceKeys.publicKey),
        }),
        ...bootstrap.target.devices.map(async (device) => ({
          userId: bootstrap.target!.id,
          deviceId: device.deviceId,
          encryptedKey: await encryptConversationKeyForParticipant(conversationKey, device.publicKey),
        })),
      ]);

      const response = await fetch("/api/conversations", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipientMainUserId: bootstrap.target.mainUserId,
          keychain,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось создать переписку");
      }

      autoCreatedTargetRef.current = bootstrap.target.mainUserId;
      await loadConversations();
      setMessages([]);
      setMessagesLoading(true);
      setSelectedConversationId(payload.conversation.id);
      setMobileSidebarOpen(false);
    } catch (conversationError) {
      reportMessengerError("start_conversation_failed", conversationError);
    } finally {
      setStartingConversation(false);
    }
  };

  const sendCurrentMessage = async () => {
    if (!draft.trim() || !selectedConversation || !selectedKeyEntry) return;

    setSending(true);

    try {
      const deviceKeys = await getOrCreateDeviceKeys();
      const conversationKey = await decryptConversationKey(selectedKeyEntry.encryptedKey, deviceKeys);
      const encrypted = await encryptMessage(draft.trim(), conversationKey);

      const response = await fetch("/api/messages", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          senderDeviceId: deviceKeys.deviceId,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось отправить сообщение");
      }

      setDraft("");
      shouldStickToBottomRef.current = true;
      const optimisticMessage: MessageView = {
        id: payload?.message?.id ?? `temp-${Date.now()}`,
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        sentAt: payload?.message?.sentAt ?? new Date().toISOString(),
        deliveredAt: null,
        senderDeviceId: deviceKeys.deviceId,
        senderMainUserId: bootstrap?.me.mainUserId ?? "",
        plainText: draft.trim(),
        optimistic: true,
      };

      setMessages((current) => {
        const next = [...current, optimisticMessage];
        latestActiveMessageIdRef.current = optimisticMessage.id;
        return next;
      });

      setConversations((current) => {
        const updated = current.map((conversation) =>
          conversation.id === selectedConversation.id
            ? {
                ...conversation,
                lastMessageAt: optimisticMessage.sentAt,
                lastMessagePreview: "[encrypted]",
              }
            : conversation
        );
        conversationListSignatureRef.current = buildConversationListSignature(updated);
        return updated;
      });

      void loadConversations().catch((refreshError) => {
        reportMessengerError("refresh_conversations_after_send_failed", refreshError);
      });
    } catch (sendError) {
      reportMessengerError("send_message_failed", sendError);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrapMessenger = async () => {
      setLoading(true);
      setConversationsLoaded(false);
      attemptedTargetRef.current = null;

      try {
        clearLegacyMessengerStorage();
        const payload = await loadBootstrap();
        if (cancelled) return;
        setBootstrap(payload);
        await loadConversations();
      } catch (bootstrapError) {
        if (cancelled) return;
        reportMessengerError("bootstrap_failed", bootstrapError);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void bootstrapMessenger();

    return () => {
      cancelled = true;
    };
  }, [targetUserId]);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId || !selectedConversation) {
      messageLoadRequestRef.current += 1;
      setMessages([]);
      setMessagesLoading(false);
      return;
    }

    shouldStickToBottomRef.current = true;
    void loadMessages(selectedConversation).catch((loadError) => {
      reportMessengerError("load_messages_failed", loadError);
    });
  }, [selectedConversationId, selectedConversationLoadSignature]);

  useEffect(() => {
    if (!messageEndRef.current) return;
    if (!shouldStickToBottomRef.current) return;

    messageEndRef.current.scrollIntoView({ block: "end" });
  }, [messages, selectedConversationId]);

  useEffect(() => {
    if (!bootstrap || loading) return;

    const params = new URLSearchParams();
    if (selectedConversationId) {
      params.set("conversationId", selectedConversationId);
    }

    const source = new EventSource(`/api/realtime${params.toString() ? `?${params.toString()}` : ""}`);

    const handleUpdate = (event: Event) => {
      if (realtimeReloadRef.current) return;
      const messageEvent = event as MessageEvent<string>;
      if (typeof messageEvent.data === "string" && messageEvent.data === lastRealtimeSnapshotRef.current) {
        return;
      }
      realtimeReloadRef.current = true;

      void (async () => {
        try {
          let snapshot: {
            selectedConversation: {
              id: string;
              sentAt: string | null;
            } | null;
          } | null = null;

          if (typeof messageEvent.data === "string") {
            lastRealtimeSnapshotRef.current = messageEvent.data;
            const parsed = JSON.parse(messageEvent.data) as {
              at: number;
              snapshot?: {
                selectedConversation: {
                  id: string;
                  sentAt: string | null;
                } | null;
              };
            };
            snapshot = parsed.snapshot ?? null;
          }

          const nextConversations = await loadConversations();

          if (
            snapshot?.selectedConversation &&
            selectedConversationIdRef.current &&
            snapshot.selectedConversation.id !== latestActiveMessageIdRef.current
          ) {
            const activeConversation =
              nextConversations.find((conversation) => conversation.id === selectedConversationIdRef.current) ?? null;
            if (activeConversation) {
              await loadMessages(activeConversation, { showLoader: false });
            }
          }
        } catch (realtimeError) {
          reportMessengerError("realtime_refresh_failed", realtimeError);
        } finally {
          realtimeReloadRef.current = false;
        }
      })();
    };

    source.addEventListener("update", handleUpdate);
    source.addEventListener("warning", () => {
      reportMessengerError("realtime_warning", "snapshot_failed");
    });
    source.onerror = () => {
      reportMessengerError("realtime_reconnecting", selectedConversationIdRef.current);
    };

    return () => {
      source.removeEventListener("update", handleUpdate);
      source.close();
    };
  }, [bootstrap, loading, selectedConversationId]);

  useEffect(() => {
    if (!bootstrap?.target || !targetUserId || !conversationsLoaded) return;
    if (autoCreatedTargetRef.current === targetUserId || attemptedTargetRef.current === targetUserId) return;

    const existing = conversations.some((conversation) => conversation.otherUser?.mainUserId === targetUserId);
    if (existing) {
      autoCreatedTargetRef.current = targetUserId;
      return;
    }

    if (startingConversation) return;
    attemptedTargetRef.current = targetUserId;
    void startConversation();
  }, [bootstrap, conversations, conversationsLoaded, startingConversation, targetUserId]);

  if (loading) {
    return (
      <div className="messenger-loading">
        <PentagramLoader />
      </div>
    );
  }

  return (
    <div className="messenger-app">
      <header className={`messenger-header ${mobileChatOpen ? "is-hidden-on-mobile-chat" : ""}`}>
        <div className="messenger-header-inner">
          <div className="brand">
            <div>
              <strong className="brand-heading">
                <span className="brand-m">m</span>
                <a href={appBaseUrl} className="brand-gomo6-link">
                  .gomo6
                </a>
              </strong>
            </div>
          </div>

          <div className="header-actions">
            {totalUnreadCount > 0 && <span className="header-unread-badge">{totalUnreadCount}</span>}
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

      <div className={`messenger-shell ${mobileChatOpen ? "mobile-chat-open" : ""}`}>
        <aside className={`sidebar-panel ${mobileSidebarOpen ? "is-open" : ""}`}>
          <div className="sidebar-top">
            <div>
              <p className="eyebrow">Диалоги</p>
              <h1>Сообщения</h1>
            </div>
          </div>

          {bootstrap?.target && bootstrap.target.devices.length === 0 && (
            <div className="inline-notice">Пользователь еще не заходил в messenger и не создал устройство.</div>
          )}

          <div className="conversation-list">
            {conversations.length === 0 && (
              <div className="empty-card">
                <MessageCircle size={18} />
                <p>Пока нет переписок.</p>
              </div>
            )}

            {conversations.map((conversation) => {
              const active = conversation.id === selectedConversationId;
              const otherUser = conversation.otherUser;

              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={`conversation-card ${active ? "is-active" : ""}`}
                  onClick={() => {
                    messageLoadRequestRef.current += 1;
                    setMessages([]);
                    setMessagesLoading(true);
                    shouldStickToBottomRef.current = true;
                    setSelectedConversationId(conversation.id);
                    setMobileSidebarOpen(false);
                  }}
                >
                  <div className="avatar">
                    {otherUser?.avatarUrl ? (
                      <img src={otherUser.avatarUrl} alt={otherUser.username} />
                    ) : (
                      <span>{initialsFrom(otherUser?.username ?? "?")}</span>
                    )}
                  </div>
                  <div className="conversation-copy">
                    <div className="conversation-head">
                      <strong>{otherUser?.username ?? "Диалог"}</strong>
                      <span>{formatRelativeMeta(conversation.lastMessageAt)}</span>
                    </div>
                    <p>{conversation.lastMessagePreview ?? "Защищенный диалог"}</p>
                    <div className="conversation-meta">
                      <span>#{otherUser?.accountNumber ?? "?"}</span>
                      {conversation.unreadCount > 0 && <span className="count-badge">{conversation.unreadCount}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className={`chat-panel ${mobileChatOpen ? "is-open" : ""}`}>
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
                    {selectedConversation.otherUser?.avatarUrl ? (
                      <img src={selectedConversation.otherUser.avatarUrl} alt={selectedConversation.otherUser.username} />
                    ) : (
                      <span>{initialsFrom(selectedConversation.otherUser?.username ?? "?")}</span>
                    )}
                  </div>

                  <div>
                    {selectedConversation.otherUser?.mainUserId ? (
                      <a
                        href={`${appBaseUrl}/profile/${selectedConversation.otherUser.mainUserId}`}
                        className="chat-profile-link"
                      >
                        <strong>{selectedConversation.otherUser?.username ?? "Диалог"}</strong>
                      </a>
                    ) : (
                      <strong>{selectedConversation.otherUser?.username ?? "Диалог"}</strong>
                    )}
                  </div>
                </div>

              </div>

              <div
                ref={messageScrollRef}
                className="message-scroll"
                onScroll={(event) => {
                  const element = event.currentTarget;
                  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
                  shouldStickToBottomRef.current = distanceToBottom < 48;
                }}
              >
                {messagesLoading ? (
                  <div className="inline-loader">
                    <PentagramLoader size="md" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="empty-thread">
                    <MessageCircle size={20} />
                    <p>Диалог создан. Первое сообщение будет зашифровано в браузере.</p>
                  </div>
                ) : (
                  messages.map((message) => {
                    const isMine = message.senderMainUserId === bootstrap?.me.mainUserId;
                    const readByPeer =
                      !!selectedConversation.lastReadAt &&
                      new Date(selectedConversation.lastReadAt).getTime() >= new Date(message.sentAt).getTime();

                    return (
                      <article key={message.id} className={`bubble-row ${isMine ? "is-mine" : ""}`}>
                        <div className={`message-bubble ${isMine ? "is-mine" : ""}`}>
                          <p>{message.plainText}</p>
                          <div className="message-meta">
                            <time>{formatDate(message.sentAt)}</time>
                            {isMine && <span>{readByPeer ? "прочитано" : "доставлено"}</span>}
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
                  onKeyDown={(event) => {
                    const isDesktop = window.matchMedia("(min-width: 981px)").matches;
                    if (isDesktop && event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (!sending && draft.trim()) {
                        void sendCurrentMessage();
                      }
                    }
                  }}
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
              {bootstrap?.target && (
                <button type="button" className="cta-button" onClick={() => void startConversation()}>
                  {startingConversation ? <PentagramLoader size="sm" /> : `Написать ${bootstrap.target.username}`}
                </button>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
