import type { AttachmentMeta } from "@/utils/mediaUpload";
export type { AttachmentMeta };

export interface UserProfileLite {
  id?: string | null;
  public_id?: number | null;
  username: string;
  display_name?: string | null;
  nickname_emoji_id?: string | null;
  is_anonymous: boolean;
  avatar_url?: string | null;
}

export interface Thread {
  id: string;
  public_id?: number | null;
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
  public_id?: number | null;
  /** Public number of the author (the users line). */
  user_public_id?: number | null;
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
