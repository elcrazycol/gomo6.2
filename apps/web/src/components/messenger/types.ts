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

  // Dedup by client_message_id: pending → matched → drop pending, unmatched → keep
  const matchedClientIds = new Set<string>();

  // Build merged view: server messages first, finding matching pending ones
  const mergedServer = normalized.map((serverMsg) => {
    const match = pending.find(
      (p) => p.client_message_id === serverMsg.client_message_id && p.sender_user_id === userId
    );
    if (match) {
      matchedClientIds.add(match.client_message_id);
      return {
        ...serverMsg,
        plainText: match.plainText,
        peerDeliveredAt: serverMsg.peerDeliveredAt ?? match.peerDeliveredAt,
        peerReadAt: serverMsg.peerReadAt ?? match.peerReadAt,
      };
    }
    return serverMsg;
  });

  // Pending messages that haven't been matched by the server yet
  const pendingStillLocal = pending.filter((p) => !matchedClientIds.has(p.client_message_id));

  // Merge server + old non-pending by id (dedup)
  const mergedById = new Map<string, MessageView>();
  for (const msg of nonPending) {
    mergedById.set(msg.client_message_id, msg);
  }
  for (const msg of mergedServer) {
    mergedById.set(msg.client_message_id, msg);
  }

  return [...pendingStillLocal, ...Array.from(mergedById.values())].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );
};
