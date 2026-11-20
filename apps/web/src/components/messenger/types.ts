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
  /**
   * MY read line (`chat_members.last_read_at`) as the server knows it. The
   * boundary of "unread": everything newer than this is unread. Local reading
   * advances it faster (see `queueMarkRead`), so consumers take the later of the
   * two.
   */
  last_read_at?: string | null;
  is_muted: boolean;
  /** The viewer blocked the peer (1:1 only). Drives the unblock panel instead
   *  of the composer; the blocked side never receives this flag. */
  blocked_by_me?: boolean;
  /** A block exists between the pair (either direction): presence is hidden
   *  and live online deltas must be ignored for this chat. */
  presence_hidden?: boolean;
  // 1:1 fields (null for groups)
  other_user_id: string | null;
  other_username: string | null;
  other_display_name?: string | null;
  other_nickname_emoji_id?: string | null;
  other_avatar_url: string | null;
  other_account_number: number | null;
  other_is_online: boolean | null;
  other_last_seen_at: string | null;
  /** The peer's read line (their chat_members.last_read_at) — real read
   *  status for the list: ≥ last_message_at means my last message was read. */
  other_last_read_at?: string | null;
  other_last_delivered_at?: string | null;
  // Group fields
  is_group: boolean;
  group_name: string | null;
  group_avatar_url: string | null;
  member_count: number;
  /** Encryption mode: "server" (default) or "e2e" (opaque client ciphertext). */
  encryption_mode?: "server" | "e2e";
  // Personal notes self-chat (client-side E2E encrypted content)
  is_notes?: boolean;
};

/** One person behind a reaction chip. */
export type ReactionUser = {
  id: string;
  username: string;
};

/**
 * One chip under a message: an emoji, how many people chose it, whether the
 * viewer is one of them, and who they are (for the "who reacted" affordance).
 */
export type ReactionSummary = {
  emoji: string;
  count: number;
  mine: boolean;
  users: ReactionUser[];
  /** When the viewer chose this emoji (RFC3339) — the cap evicts by it. */
  mineAt?: string;
};

export type MessageType = "text" | "media" | "voice" | "gift" | "share" | "system";

export type MessageEnc = {
  v: number;
  alg?: string;
};

export type MessageView = {
  id: string;
  /** Monotonic PostgreSQL BIGINT cursor serialized as a decimal string. */
  event_id?: string;
  conversation_id: string;
  sender_user_id: string;
  sender_username?: string;
  parent_message_id: string | null;
  type?: MessageType;
  content: string;
  payload?: Record<string, unknown> | null;
  /** Client E2E envelope version (v>=1 means opaque `e2e1:` ciphertext). */
  enc?: MessageEnc | null;
  is_edited: boolean;
  is_deleted: boolean;
  edited_at: string | null;
  sent_at: string;
  client_id: string;
  attachments?: Attachment[];
  /** Reaction chips, ordered by popularity (see `reactions.ts`). */
  reactions?: ReactionSummary[];
  /**
   * Who has played this voice note (server-backed, per user). The dot is a fact
   * about a person: an incoming note is unheard until I play it, my own until
   * the peer does.
   */
  voiceListenedBy?: string[];
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

/** One entry of the caller's direct-message block list (blocker-only view). */
export type BlockedUser = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  blocked_at: string;
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
