export interface BotConfig {
  token: string;
  baseUrl?: string;
  wsUrl?: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  count?: number;
}

export interface Thread {
  id: string;
  board_id: string;
  channel_id?: string | null;
  user_id: string;
  title: string;
  content: string;
  content_json?: unknown;
  image_url?: string | null;
  image_urls?: string[];
  attachments?: Attachment[];
  tags?: string[];
  post_count: number;
  server_domain: string;
  created_at: string;
  updated_at: string;
  is_remote: boolean;
  username?: string;
  avatar_url?: string | null;
  is_anonymous?: boolean;
}

export interface Post {
  id: string;
  thread_id: string;
  user_id: string;
  content: string;
  content_json?: unknown;
  image_url?: string | null;
  image_urls?: string[];
  attachments?: Attachment[];
  reply_to?: string | null;
  is_private: boolean;
  private_recipient_id?: string | null;
  server_domain: string;
  created_at: string;
  is_remote: boolean;
  username?: string;
  avatar_url?: string | null;
}

export interface Board {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  is_gomosub: boolean;
  is_rules_board: boolean;
  owner_id?: string | null;
  visibility?: string;
  cover_image_url?: string | null;
  gomosub_avatar_url?: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  username: string;
  display_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  is_anonymous: boolean;
  thread_count: number;
  post_count: number;
  garma: number;
  drops: number;
  created_at: string;
  is_online?: boolean;
  last_seen?: string | null;
}

export interface Conversation {
  id: string;
  last_message_at: string;
  last_message_preview: string;
  last_message_sender_id: string;
  pinned_message_id?: string | null;
  updated_at: string;
  unread_count: number;
  last_read_at?: string | null;
  is_muted: boolean;
  other_user_id: string;
  other_username: string;
  other_display_name?: string | null;
  other_avatar_url?: string | null;
  other_account_number?: number | null;
  other_is_online?: boolean;
  other_last_seen_at?: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  parent_message_id?: string | null;
  content: string;
  is_edited: boolean;
  is_deleted: boolean;
  edited_at?: string | null;
  sent_at: string;
  client_id?: string;
}

export interface Attachment {
  mime: string;
  name: string;
  size: number;
  type: string;
  url: string;
}

export interface CreateThreadParams {
  board_id: string;
  channel_id?: string;
  title: string;
  content: string;
  content_json?: unknown;
  image_urls?: string[];
  attachments?: Attachment[];
}

export interface CreatePostParams {
  thread_id: string;
  content: string;
  content_json?: unknown;
  image_urls?: string[];
  attachments?: Attachment[];
  reply_to?: string;
}

export interface RawChatMessage {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  parent_message_id?: string | null;
  content: string;
  is_edited: boolean;
  is_deleted: boolean;
  edited_at?: string | null;
  sent_at: string;
  client_id?: string;
}

export interface RawWsMessage {
  type: string;
  room?: string;
  data: unknown;
  user_id?: string;
  username?: string;
  timestamp: number;
}
