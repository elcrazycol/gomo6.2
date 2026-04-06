export interface AttachmentMeta {
  url: string;
  type: "image" | "video" | "audio" | "file";
  mime?: string | null;
  name?: string | null;
  size?: number | null;
  poster?: string | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration?: number | null;
  coverArt?: string | null;
}

export interface UserProfileLite {
  id?: string | null;
  username: string;
  is_anonymous: boolean;
  avatar_url?: string | null;
}

export interface Thread {
  id: string;
  title: string;
  content: string;
  created_at: string;
  user_id: string | null;
  custom_message?: string | null;
  image_url: string | null;
  image_urls?: string[] | null;
  attachments?: AttachmentMeta[] | null;
  tags?: Record<string, unknown>;
  boards: {
    slug: string;
    name: string;
    is_rules_board: boolean;
    is_gomosub?: boolean;
  };
  profiles: UserProfileLite | null;
}

export interface Post {
  id: string;
  thread_id?: string;
  content: string;
  created_at: string;
  user_id: string | null;
  reply_to: string | null;
  is_private: boolean;
  private_recipient_id: string | null;
  image_url: string | null;
  image_urls?: string[] | null;
  imageUrls?: string[];
  attachments?: AttachmentMeta[] | null;
  profiles: UserProfileLite | null;
}
