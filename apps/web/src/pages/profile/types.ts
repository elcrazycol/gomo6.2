import type { AchievementLevel } from "@/components/AchievementCard";

/** Raw row returned by /profiles. */
export interface Profile {
  id: string;
  username: string;
  display_name?: string | null;
  nickname_emoji_id?: string | null;
  bio: string | null;
  bio_json?: unknown;
  is_anonymous: boolean;
  thread_count: number;
  post_count: number;
  wall_post_count: number;
  comment_count: number;
  likes_received_count: number;
  views_received_count: number;
  garma: number;
  drops: number;
  created_at: string;
  avatar_url?: string | null;
  background_url?: string | null;
  background_variant?: string;
  theme_enabled?: boolean;
  theme_tokens?: Record<string, string> | null;
  account_number?: number | null;
  is_online?: boolean;
  last_seen?: string | null;
  /** Raw API column name for the row returned by /profiles. */
  last_seen_at?: string | null;
}

/** Raw user_achievements join row (one per unlocked achievement). */
export interface UserAchievementRaw {
  current_level?: number;
  level?: number;
  unlocked_at?: string;
  is_pinned?: boolean;
  pinned_order?: number;
  progress_current?: number;
  achievements?: {
    id: string;
    group_key?: string;
    title?: string;
    name: string;
    description: string;
    icon?: string;
    category?: string;
    rarity?: string;
    achievement_type?: string;
    hidden?: boolean;
    reward_type?: string;
    reward_value?: string;
    levels?: AchievementLevel[];
  };
}

export interface AvatarHistoryItem {
  id: string;
  avatar_url: string;
  is_current: boolean;
}

/** Visibility flags returned by the owner's privacy endpoint. Field names match
 * the API; values may be absent for rows created before the columns existed. */
export interface ProfilePrivacyData {
  show_last_seen?: boolean;
  show_online_status?: boolean;
  show_profile_wall?: boolean;
  allow_wall_posts_from_others?: boolean;
  show_threads_tab?: boolean;
  show_profile_stats?: boolean;
  show_detailed_stats?: boolean;
  stats_visibility?: Record<string, boolean>;
  private_profile?: boolean;
  private_hide_avatar?: boolean;
  private_hide_wall?: boolean;
  private_hide_threads?: boolean;
  private_hide_stats?: boolean;
  private_hide_friends?: boolean;
  private_hide_gifts?: boolean;
  private_hide_achievements?: boolean;
}