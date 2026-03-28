"use client";

import { useEffect, useMemo, useState } from "react";
import {
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
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<ApiMessage & { plainText: string }>>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Инициализируем защищенное устройство...");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
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
    if (!selectedConversationId && payload.conversations[0]) {
      setSelectedConversationId(payload.conversations[0].id);
    }
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

  useEffect(() => {
    const boot = async () => {
      try {
        await initSodium();
        const payload = await loadBootstrap();
        setBootstrap(payload);
        setStatus("Загружаем переписки...");
        await loadConversations();
        setLoading(false);
      } catch (bootError) {
        setError(bootError instanceof Error ? bootError.message : "Ошибка загрузки");
        setLoading(false);
      }
    };

    boot();
  }, []);

  useEffect(() => {
    if (!selectedConversation) return;

    loadMessages(selectedConversation.id, selectedConversation.encryptedKey).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Не удалось расшифровать сообщения");
    });

    const interval = window.setInterval(() => {
      loadMessages(selectedConversation.id, selectedConversation.encryptedKey).catch(() => undefined);
      loadConversations().catch(() => undefined);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [selectedConversation?.id, selectedConversation?.encryptedKey]);

  const startConversation = async () => {
    if (!bootstrap?.target) return;
    if (!bootstrap.target.publicKey) {
      setError("Собеседник ещё не активировал E2EE-мессенджер. Пусть хотя бы один раз откроет m.gomo6.wtf.");
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

  if (loading) {
    return (
      <div className="shell">
        <section className="panel sidebar">
          <div className="brand">
            <span className="eyebrow">Secure Bridge</span>
            <h1>gomo6 messenger</h1>
            <p>{status}</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="panel sidebar">
        <div className="brand">
          <span className="eyebrow">End-to-End Encrypted</span>
          <h1>gomo6 messenger</h1>
          <p>
            Привет, {username}. Ключи устройства созданы локально в браузере, сервер хранит только шифротекст и публичные ключи.
          </p>
        </div>

        {bootstrap?.target && !conversations.some((conversation) => conversation.otherUser.mainUserId === bootstrap.target?.mainUserId) && (
          <div className="conversation">
            <strong>Новая переписка</strong>
            <div className="meta">{bootstrap.target.username}</div>
            <div style={{ marginTop: 12 }}>
              <button className="button primary" type="button" onClick={startConversation} disabled={startingConversation}>
                {startingConversation ? "Создаём..." : "Начать диалог"}
              </button>
            </div>
          </div>
        )}

        <div className="conversation-list">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className={`conversation ${selectedConversationId === conversation.id ? "active" : ""}`}
              onClick={() => setSelectedConversationId(conversation.id)}
            >
              <strong>{conversation.otherUser.username}</strong>
              <div className="meta">
                {conversation.lastMessageAt
                  ? `Активность: ${new Date(conversation.lastMessageAt).toLocaleString("ru-RU")}`
                  : "Сообщений пока нет"}
              </div>
              {conversation.unreadCount > 0 && <div style={{ marginTop: 10 }}><span className="badge">{conversation.unreadCount}</span></div>}
            </button>
          ))}

          {conversations.length === 0 && (
            <div className="empty">
              Переписок пока нет. Открой профиль пользователя в основной соцсети и нажми кнопку сообщений.
            </div>
          )}
        </div>
      </aside>

      <main className="panel main">
        <div className="topbar">
          <div>
            <h2>{selectedConversation?.otherUser.username ?? "Защищённые сообщения"}</h2>
            <div className="meta">
              {selectedConversation
                ? "Сообщения шифруются на этом устройстве с XChaCha20-Poly1305 и sealed box поверх ключа диалога."
                : "Выбери диалог слева или начни новый."}
            </div>
          </div>
          <a className="button secondary" href="https://gomo6.wtf">
            Назад в gomo6
          </a>
        </div>

        <div className="messages">
          {messages.length === 0 && <div className="empty">Здесь пока тихо.</div>}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`bubble ${message.senderMainUserId === bootstrap?.me.mainUserId ? "self" : ""}`}
            >
              {message.plainText}
              <div className="message-time" style={{ marginTop: 10 }}>
                {new Date(message.createdAt).toLocaleString("ru-RU")}
              </div>
            </div>
          ))}
        </div>

        <div className="composer">
          {error && <div style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</div>}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void sendCurrentMessage();
            }}
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={selectedConversation ? "Напиши сообщение..." : "Сначала открой или создай диалог"}
              disabled={!selectedConversation || sending}
            />
            <div className="actions">
              <div className="note">Ключи не покидают браузер в открытом виде.</div>
              <button className="button primary" type="submit" disabled={!selectedConversation || sending || !draft.trim()}>
                {sending ? "Шифруем..." : "Отправить"}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
};
