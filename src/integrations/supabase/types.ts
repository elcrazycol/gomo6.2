export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      achievements: {
        Row: {
          category: string
          created_at: string | null
          description: string
          icon: string | null
          id: string
          name: string
          reward_type: string | null
          reward_value: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          description: string
          icon?: string | null
          id: string
          name: string
          reward_type?: string | null
          reward_value?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string
          icon?: string | null
          id?: string
          name?: string
          reward_type?: string | null
          reward_value?: string | null
        }
        Relationships: []
      }
      board_visits: {
        Row: {
          board_slug: string
          id: string
          user_id: string
          visited_at: string | null
        }
        Insert: {
          board_slug: string
          id?: string
          user_id: string
          visited_at?: string | null
        }
        Update: {
          board_slug?: string
          id?: string
          user_id?: string
          visited_at?: string | null
        }
        Relationships: []
      }
      boards: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_rules_board: boolean | null
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_rules_board?: boolean | null
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_rules_board?: boolean | null
          name?: string
          slug?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          related_post_id: string | null
          related_thread_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          related_post_id?: string | null
          related_thread_id?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          related_post_id?: string | null
          related_thread_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_related_post_id_fkey"
            columns: ["related_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_related_thread_id_fkey"
            columns: ["related_thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          content: string
          created_at: string
          id: string
          image_url: string | null
          image_urls: Json | null
          is_private: boolean
          private_recipient_id: string | null
          reply_to: string | null
          thread_id: string
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          image_url?: string | null
          image_urls?: Json | null
          is_private?: boolean
          private_recipient_id?: string | null
          reply_to?: string | null
          thread_id: string
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          image_url?: string | null
          image_urls?: Json | null
          is_private?: boolean
          private_recipient_id?: string | null
          reply_to?: string | null
          thread_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          edit_count: number | null
          id: string
          image_upload_count: number | null
          is_anonymous: boolean | null
          post_count: number | null
          thread_count: number | null
          username: string
          account_number: number | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          edit_count?: number | null
          id: string
          image_upload_count?: number | null
          is_anonymous?: boolean | null
          post_count?: number | null
          thread_count?: number | null
          username: string
          account_number?: number | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          edit_count?: number | null
          id?: string
          image_upload_count?: number | null
          is_anonymous?: boolean | null
          post_count?: number | null
          thread_count?: number | null
          username?: string
          account_number?: number | null
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string | null
          id: string
          moderator_id: string | null
          moderator_note: string | null
          reason: string
          reported_post_id: string | null
          reported_thread_id: string | null
          reporter_id: string | null
          resolved_at: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          moderator_id?: string | null
          moderator_note?: string | null
          reason: string
          reported_post_id?: string | null
          reported_thread_id?: string | null
          reporter_id?: string | null
          resolved_at?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          moderator_id?: string | null
          moderator_note?: string | null
          reason?: string
          reported_post_id?: string | null
          reported_thread_id?: string | null
          reporter_id?: string | null
          resolved_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_moderator_id_fkey"
            columns: ["moderator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reported_post_id_fkey"
            columns: ["reported_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reported_thread_id_fkey"
            columns: ["reported_thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_subscriptions: {
        Row: {
          created_at: string | null
          id: string
          thread_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          thread_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_subscriptions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      threads: {
        Row: {
          board_id: string
          content: string
          created_at: string
          id: string
          image_url: string | null
          image_urls: Json | null
          post_count: number
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          board_id: string
          content: string
          created_at?: string
          id?: string
          image_url?: string | null
          image_urls?: Json | null
          post_count?: number
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          board_id?: string
          content?: string
          created_at?: string
          id?: string
          image_url?: string | null
          image_urls?: Json | null
          post_count?: number
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "threads_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      user_achievements: {
        Row: {
          achievement_id: string
          id: string
          unlocked_at: string | null
          user_id: string
        }
        Insert: {
          achievement_id: string
          id?: string
          unlocked_at?: string | null
          user_id: string
        }
        Update: {
          achievement_id?: string
          id?: string
          unlocked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_bans: {
        Row: {
          banned_by: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          is_permanent: boolean | null
          reason: string
          user_id: string
        }
        Insert: {
          banned_by?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_permanent?: boolean | null
          reason: string
          user_id: string
        }
        Update: {
          banned_by?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_permanent?: boolean | null
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      user_daily_visits: {
        Row: {
          created_at: string | null
          id: string
          user_id: string
          visit_date: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          user_id: string
          visit_date?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          user_id?: string
          visit_date?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_session_time: {
        Row: {
          id: string
          last_updated: string | null
          total_minutes: number | null
          user_id: string
        }
        Insert: {
          id?: string
          last_updated?: string | null
          total_minutes?: number | null
          user_id: string
        }
        Update: {
          id?: string
          last_updated?: string | null
          total_minutes?: number | null
          user_id?: string
        }
        Relationships: []
      }
      user_terms_acceptance: {
        Row: {
          accepted_at: string | null
          id: string
          ip_address: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          id?: string
          ip_address?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          id?: string
          ip_address?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_warnings: {
        Row: {
          created_at: string | null
          id: string
          reason: string
          user_id: string
          warned_by: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          reason: string
          user_id: string
          warned_by?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          reason?: string
          user_id?: string
          warned_by?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          id: string
          user1_id: string
          user2_id: string
          last_message_at: string
          created_at: string
        }
        Insert: {
          id?: string
          user1_id: string
          user2_id: string
          last_message_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          user1_id?: string
          user2_id?: string
          last_message_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_user1_id_fkey"
            columns: ["user1_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user2_id_fkey"
            columns: ["user2_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          sender_id: string
          recipient_id: string
          content: string
          is_read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          sender_id: string
          recipient_id: string
          content: string
          is_read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          conversation_id?: string
          sender_id?: string
          recipient_id?: string
          content?: string
          is_read?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      award_achievement: {
        Args: { _achievement_id: string; _user_id: string }
        Returns: undefined
      }
      award_achievement_with_level: {
        Args: { _user_id: string; _achievement_type: string; _level: number }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      get_post_likes_count: {
        Args: { post_uuid: string }
        Returns: number
      }
      get_recent_post_likers: {
        Args: { post_uuid: string; limit_count?: number }
        Returns: {
          username: string
          id: string
        }[]
      }
      has_user_liked_post: {
        Args: { post_uuid: string; user_uuid: string }
        Returns: boolean
      }
      get_user_likes_given_count: {
        Args: { user_uuid: string }
        Returns: number
      }
      get_user_likes_received_count: {
        Args: { user_uuid: string }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
