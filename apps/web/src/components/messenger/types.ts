export type ProfileSummary = {
  id: string;
  username: string;
  avatar_url: string | null;
  account_number: number | null;
  is_online: boolean | null;
  last_seen_at: string | null;
};

export type ConversationRow = {
  conversation_id: string;
  unread_count_cache: number;
  last_read_at: string | null;
};

export type ConversationRecord = {
  id: string;
  last_message_at: string | null;
  updated_at: string;
  pinned_message_id: string | null;
};

export type ConversationMemberRecord = {
  conversation_id: string;
  user_id: string;
};

export type ChatMessageRecord = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  client_message_id: string;
  sent_at: string;
  content_encrypted: string;
  content: string; // decrypted by server before sending to client
};

export type ChatReceiptRecord = {
  message_id: string;
  user_id: string;
  delivered_at: string | null;
  read_at: string | null;
};

export type ConversationView = {
  id: string;
  unreadCount: number;
  lastReadAt: string | null;
  lastMessageAt: string | null;
  pinnedMessageId: string | null;
  otherUser: ProfileSummary;
};

export type PinnedMessageInfo = {
  id: string;
  plainText: string;
  sender_user_id: string;
  sender_username: string;
  sent_at: string;
} | null;

export type MessageView = ChatMessageRecord & {
  plainText: string;
  peerDeliveredAt: string | null;
  peerReadAt: string | null;
  localStatus?: "pending";
};

export const mergeMessages = (current: MessageView[], normalized: MessageView[], userId: string): MessageView[] => {
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
