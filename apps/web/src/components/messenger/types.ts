// ─── Messenger types — clean, minimal, precise ──────────────────────────

export type ProfileSummary = {
  id: string;
  username: string;
  avatar_url: string | null;
  account_number: number | null;
  is_online: boolean | null;
  last_seen_at: string | null;
};

export type ConversationView = {
  id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender_id: string | null;
  pinned_message_id: string | null;
  updated_at: string;
  unread_count: number;
  is_muted: boolean;
  // 1:1 fields (null for groups)
  other_user_id: string | null;
  other_username: string | null;
  other_display_name?: string | null;
  other_nickname_emoji_id?: string | null;
  other_avatar_url: string | null;
  other_account_number: number | null;
  other_is_online: boolean | null;
  other_last_seen_at: string | null;
  // Group fields
  is_group: boolean;
  group_name: string | null;
  group_avatar_url: string | null;
  member_count: number;
  // Personal notes self-chat (client-side E2E encrypted content)
  is_notes?: boolean;
};

export type MessageView = {
  id: string;
  /** Monotonic PostgreSQL BIGINT cursor serialized as a decimal string. */
  event_id?: string;
  conversation_id: string;
  sender_user_id: string;
  sender_username?: string;
  parent_message_id: string | null;
  content: string;
  is_edited: boolean;
  is_deleted: boolean;
  edited_at: string | null;
  sent_at: string;
  client_id: string;
  attachments?: Attachment[];
  // Notes self-chat: client-side E2E-encrypted metadata (pin/folder/tags).
  // notes_meta is the wire ciphertext; notesPinned/notesFolder/notesTags are
  // the decrypted values the store exposes to the UI.
  notes_meta?: string | null;
  notesPinned?: boolean;
  notesFolder?: string | null;
  notesTags?: string[];
  // Client-side state
  localStatus?: "sending" | "sent" | "failed";
};

export type Attachment = {
  id?: string;
  url: string;
  type: "image" | "video" | "audio" | "file";
  name: string;
  size: number;
  mime: string;
  /** JSON metadata: width, height, preview_key, thumb_hash (and lqip for legacy). */
  meta?: string | null;
  sort_order?: number;
};

/** In-flight upload shown as a progress chip in the composer. */
export type UploadingFile = {
  id: string;
  name: string;
  percent: number;
  type: Attachment["type"];
};

export type ReceiptRow = {
  message_id: string;
  user_id: string;
  delivered_at: string | null;
  read_at: string | null;
};

export type TypingUser = {
  user_id: string;
  username: string;
  is_typing: boolean;
  timestamp: number;
};

export type GroupMember = {
  user_id: string;
  username: string;
  display_name: string | null;
  nickname_emoji_id?: string | null;
  avatar_url: string | null;
  role: string;
  joined_at: string;
  is_online: boolean | null;
  last_seen_at: string | null;
};

export type WsEvent =
  | { type: "new_chat_message"; data: MessageView }
  | { type: "message_edited"; data: { id: string; content: string; edited_at: string } }
  | { type: "message_notes_meta"; data: { id: string; conversation_id: string; notes_meta: string } }
  | { type: "message_deleted"; data: { id: string } }
  | { type: "read_receipt"; data: { message_id: string; user_id: string } }
  | { type: "chat_typing"; data: { user_id: string; username: string; is_typing: boolean } }
  | { type: "connected"; data: { user_id: string } }
  | { type: "user_online"; data: { user_id: string; username: string } }
  | { type: "user_offline"; data: { user_id: string; username: string } };
