"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { PentagramLoader } from "@/components/pentagram-loader";
import {
  clearLegacyMessengerStorage,
  createConversationKey,
  decryptConversationKey,
  decryptMessage,
  encryptConversationKeyForParticipant,
  encryptMessage,
  getOrCreateDeviceKeys,
  initSodium,
} from "@/lib/crypto";

type BootstrapPayload = {
  me: {
    id: string;
    mainUserId: string;
    username: string;
    publicKey: string | null;
  };
  target: {
    id: string;
    mainUserId: string;
    username: string;
    publicKey: string | null;
  } | null;
};

type Conversation = {
  id: string;
  createdAt: string;
  otherUser: {
    id: string;
    mainUserId: string;
    username: string;
  };
  encryptedKey: string;
  unreadCount: number;
  lastMessageAt: string | null;
};

type ApiMessage = {
  id: string;
  ciphertext: string;
  nonce: string;
  createdAt: string;
  senderMainUserId: string;
};

type Props = {
  username: string;
  targetUserId: string | null;
};

export const MessengerClient = ({ username, targetUserId }: Props) => {
  const autoCreatedTargetRef = useRef<string | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<ApiMessage & { plainText: string }>>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const [mobileListVisible, setMobileListVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  const loadBootstrap = async () => {
    const keys = await getOrCreateDeviceKeys();
    const response = await fetch(`/api/bootstrap${targetUserId ? `?targetUserId=${encodeURIComponent(targetUserId)}` : ""}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        publicKey: keys.publicKey,
      }),
    });

    if (!response.ok) {
      throw new Error("Не удалось подготовить устройство");
    }

    return (await response.json()) as BootstrapPayload;
  };

  const loadConversations = async () => {
    const response = await fetch("/api/conversations", {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Не удалось загрузить переписки");
    }

    const payload = (await response.json()) as { conversations: Conversation[] };
    setConversations(payload.conversations);
    setSelectedConversationId((current) => {
      if (current && payload.conversations.some((conversation) => conversation.id === current)) {
        return current;
      }

      return payload.conversations[0]?.id ?? null;
    });
  };

  const loadMessages = async (conversationId: string, encryptedKey: string) => {
    const keys = await getOrCreateDeviceKeys();
    const conversationKey = await decryptConversationKey(encryptedKey, keys);
    const response = await fetch(`/api/messages/${conversationId}`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Не удалось загрузить сообщения");
    }

    const payload = (await response.json()) as { messages: ApiMessage[] };
    const decrypted = await Promise.all(
      payload.messages.map(async (message) => ({
        ...message,
        plainText: await decryptMessage(message.ciphertext, message.nonce, conversationKey),
      }))
    );
    setMessages(decrypted);

    await fetch(`/api/messages/${conversationId}/read`, {
      method: "POST",
      credentials: "include",
    });
  };

  const startConversation = async () => {
    if (!bootstrap?.target) return;
    if (!bootstrap.target.publicKey) {
      setError("Пока нельзя начать диалог");
      return;
    }

    setStartingConversation(true);
    setError(null);

    try {
      const keys = await getOrCreateDeviceKeys();
      const conversationKey = await createConversationKey();
      const senderEncryptedKey = await encryptConversationKeyForParticipant(conversationKey, keys.publicKey);
      const recipientEncryptedKey = await encryptConversationKeyForParticipant(conversationKey, bootstrap.target.publicKey);

      const response = await fetch("/api/conversations", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipientMainUserId: bootstrap.target.mainUserId,
          senderEncryptedKey,
          recipientEncryptedKey,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Не удалось создать переписку");
      }

      await loadConversations();
      setSelectedConversationId(payload.conversation.id);
      setMobileListVisible(false);
      autoCreatedTargetRef.current = bootstrap.target.mainUserId;
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : "Не удалось создать переписку");
    } finally {
      setStartingConversation(false);
    }
  };

  const sendCurrentMessage = async () => {
    if (!draft.trim() || !selectedConversation) return;

    setSending(true);
    setError(null);

    try {
      const keys = await getOrCreateDeviceKeys();
      const conversationKey = await decryptConversationKey(selectedConversation.encryptedKey, keys);
      const encrypted = await encryptMessage(draft.trim(), conversationKey);

      const response = await fetch("/api/messages", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Не удалось отправить сообщение");
      }

      setDraft("");
      await loadMessages(selectedConversation.id, selectedConversation.encryptedKey);
      await loadConversations();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Не удалось отправить сообщение");
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    clearLegacyMessengerStorage();

    const boot = async () => {
      try {
        await initSodium();
        const payload = await loadBootstrap();
        setBootstrap(payload);
        await loadConversations();
      } catch (bootError) {
        setError(bootError instanceof Error ? bootError.message : "Ошибка загрузки");
      } finally {
        setLoading(false);
      }
    };

    void boot();
  }, []);

  useEffect(() => {
    if (!bootstrap?.target) return;
    if (conversations.some((conversation) => conversation.otherUser.mainUserId === bootstrap.target?.mainUserId)) {
      autoCreatedTargetRef.current = bootstrap.target.mainUserId;
      return;
    }
    if (!bootstrap.target.publicKey) return;
    if (startingConversation) return;
    if (autoCreatedTargetRef.current === bootstrap.target.mainUserId) return;

    void startConversation();
  }, [bootstrap?.target?.mainUserId, bootstrap?.target?.publicKey, conversations, startingConversation]);

  useEffect(() => {
    if (!selectedConversation) return;

    void loadMessages(selectedConversation.id, selectedConversation.encryptedKey).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Не удалось расшифровать сообщения");
    });

    const interval = window.setInterval(() => {
      void loadMessages(selectedConversation.id, selectedConversation.encryptedKey).catch(() => undefined);
      void loadConversations().catch(() => undefined);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [selectedConversation?.id, selectedConversation?.encryptedKey]);

  if (loading) {
    return (
      <div className="loading-shell">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="messenger-page">
      <header className="messenger-header">
        <a className="brand-link" href="https://gomo6.wtf" aria-label="gomo6">
          <span className="brand-mark" />
          <span className="brand-text">gomo6</span>
        </a>
        <button
          type="button"
          className="mobile-conversations-toggle"
          onClick={() => setMobileListVisible((value) => !value)}
          aria-label="Диалоги"
        >
          <MessageCircle className="toggle-icon" />
        </button>
      </header>

      <div className="shell">
        <aside className={`panel sidebar ${mobileListVisible ? "mobile-visible" : "mobile-hidden"}`}>
          {bootstrap?.target && !conversations.some((conversation) => conversation.otherUser.mainUserId === bootstrap.target?.mainUserId) && (
            <div className="conversation pending">
              <span className={`conversation-dot ${startingConversation ? "is-loading" : ""}`} />
              <strong>{bootstrap.target.username}</strong>
            </div>
          )}

          <div className="conversation-list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`conversation ${selectedConversationId === conversation.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedConversationId(conversation.id);
                  setMobileListVisible(false);
                }}
              >
                <strong>{conversation.otherUser.username}</strong>
                <div className="meta">
                  {conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleString("ru-RU") : ""}
                </div>
                {conversation.unreadCount > 0 && <span className="badge">{conversation.unreadCount}</span>}
              </button>
            ))}
          </div>
        </aside>

        <main className={`panel main ${mobileListVisible ? "mobile-hidden" : "mobile-visible"}`}>
          <div className="topbar">
            <div className="topbar-title">
              <span className="topbar-name">{selectedConversation?.otherUser.username ?? username}</span>
            </div>
          </div>

          <div className="messages">
            {messages.length === 0 && !startingConversation && !selectedConversation ? (
              <div className="messages-empty" />
            ) : null}

            {messages.length === 0 && startingConversation ? (
              <div className="messages-loader">
                <PentagramLoader size="sm" />
              </div>
            ) : null}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`bubble ${message.senderMainUserId === bootstrap?.me.mainUserId ? "self" : ""}`}
              >
                {message.plainText}
                <div className="message-time">{new Date(message.createdAt).toLocaleString("ru-RU")}</div>
              </div>
            ))}
          </div>

          <div className="composer">
            {error && <div className="composer-error">{error}</div>}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendCurrentMessage();
              }}
            >
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder=""
                disabled={!selectedConversation || sending}
              />
              <div className="actions">
                <button className="button primary" type="submit" disabled={!selectedConversation || sending || !draft.trim()}>
                  {sending ? "..." : "OK"}
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
};
