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
  other_avatar_url: string | null;
  other_account_number: number | null;
  other_is_online: boolean | null;
  other_last_seen_at: string | null;
  // Group fields
  is_group: boolean;
  group_name: string | null;
  group_avatar_url: string | null;
  member_count: number;
};

export type MessageView = {
  id: string;
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
  meta?: string | null;
  sort_order?: number;
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
  avatar_url: string | null;
  role: string;
  joined_at: string;
  is_online: boolean | null;
  last_seen_at: string | null;
};

export type WsEvent =
  | { type: "new_chat_message"; data: MessageView }
  | { type: "message_edited"; data: { id: string; content: string; edited_at: string } }
  | { type: "message_deleted"; data: { id: string } }
  | { type: "read_receipt"; data: { message_id: string; user_id: string } }
  | { type: "chat_typing"; data: { user_id: string; username: string; is_typing: boolean } }
  | { type: "connected"; data: { user_id: string } }
  | { type: "user_online"; data: { user_id: string; username: string } }
  | { type: "user_offline"; data: { user_id: string; username: string } };
