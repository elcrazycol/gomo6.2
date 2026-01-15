-- Fix RLS performance issues by wrapping auth functions in SELECT statements
-- This addresses Supabase linter warnings about auth_rls_initplan

-- Fix profiles table policies
DROP POLICY IF EXISTS "Users can create their own profile" ON public.profiles;
CREATE POLICY "Users can create their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK ((select auth.uid()) = id);

-- Consolidate multiple UPDATE policies for profiles (same logic)
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own 2FA settings" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
FOR UPDATE USING ((select auth.uid()) = id);

-- Fix posts table policies
DROP POLICY IF EXISTS "Authenticated users can create posts" ON public.posts;
CREATE POLICY "Authenticated users can create posts"
  ON public.posts FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Moderators can delete posts" ON public.posts;
CREATE POLICY "Moderators can delete posts"
  ON public.posts FOR DELETE
  USING ((select public.has_role(auth.uid(), 'admin'::app_role)) OR (select public.has_role(auth.uid(), 'moderator'::app_role)));

DROP POLICY IF EXISTS "Moderators can update posts" ON public.posts;
CREATE POLICY "Moderators can update posts"
  ON public.posts FOR UPDATE
  USING ((select public.has_role(auth.uid(), 'admin'::app_role)) OR (select public.has_role(auth.uid(), 'moderator'::app_role)));

DROP POLICY IF EXISTS "Users can delete their own posts" ON public.posts;
CREATE POLICY "Users can delete their own posts"
  ON public.posts FOR DELETE
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own posts" ON public.posts;
CREATE POLICY "Users can update their own posts"
  ON public.posts FOR UPDATE
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Only admins can post on rules board" ON public.posts;
CREATE POLICY "Only admins can post on rules board"
  ON public.posts FOR INSERT
  WITH CHECK (
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.threads t
        JOIN public.boards b ON t.board_id = b.id
        WHERE t.id = thread_id AND b.is_rules_board = true
      )
      THEN (select public.has_role(auth.uid(), 'admin'::app_role))
      ELSE (select auth.uid()) = user_id
    END
  );

-- Fix threads table policies
DROP POLICY IF EXISTS "Authenticated users can create threads" ON public.threads;
CREATE POLICY "Authenticated users can create threads"
  ON public.threads FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Moderators can delete threads" ON public.threads;
CREATE POLICY "Moderators can delete threads"
  ON public.threads FOR DELETE
  USING ((select public.has_role(auth.uid(), 'admin'::app_role)) OR (select public.has_role(auth.uid(), 'moderator'::app_role)));

DROP POLICY IF EXISTS "Moderators can update threads" ON public.threads;
CREATE POLICY "Moderators can update threads"
  ON public.threads FOR UPDATE
  USING ((select public.has_role(auth.uid(), 'admin'::app_role)) OR (select public.has_role(auth.uid(), 'moderator'::app_role)));

DROP POLICY IF EXISTS "Only moderators can create threads on rules board" ON public.threads;
CREATE POLICY "Only moderators can create threads on rules board"
  ON public.threads FOR INSERT
  WITH CHECK (
    CASE
      WHEN (SELECT is_rules_board FROM public.boards WHERE id = board_id) = true
      THEN (select public.has_role(auth.uid(), 'admin'::app_role)) OR (select public.has_role(auth.uid(), 'moderator'::app_role))
      ELSE (select auth.uid()) = user_id
    END
  );

DROP POLICY IF EXISTS "Only admins can create threads on bugs board" ON public.threads;
CREATE POLICY "Only admins can create threads on bugs board"
  ON public.threads FOR INSERT
  WITH CHECK (
    CASE
      WHEN (SELECT slug FROM public.boards WHERE id = board_id) = 'bugs'
      THEN (select public.has_role(auth.uid(), 'admin'::app_role))
      ELSE (select auth.uid()) = user_id
    END
  );

-- Fix notifications table policies
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING ((select auth.uid()) = user_id);

-- Fix user_achievements table policies
DROP POLICY IF EXISTS "Users earn their achievements automatically" ON public.user_achievements;
CREATE POLICY "Users earn their achievements automatically"
  ON public.user_achievements FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

-- Fix thread_subscriptions table policies
DROP POLICY IF EXISTS "Users can view their own subscriptions" ON public.thread_subscriptions;
CREATE POLICY "Users can view their own subscriptions"
  ON public.thread_subscriptions FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create their own subscriptions" ON public.thread_subscriptions;
CREATE POLICY "Users can create their own subscriptions"
  ON public.thread_subscriptions FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own subscriptions" ON public.thread_subscriptions;
CREATE POLICY "Users can delete their own subscriptions"
  ON public.thread_subscriptions FOR DELETE
  USING ((select auth.uid()) = user_id);

-- Fix user_daily_visits table policies
DROP POLICY IF EXISTS "Users can insert their own visits" ON public.user_daily_visits;
CREATE POLICY "Users can insert their own visits"
  ON public.user_daily_visits FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own visits" ON public.user_daily_visits;
CREATE POLICY "Users can view their own visits"
  ON public.user_daily_visits FOR SELECT
  USING ((select auth.uid()) = user_id);

-- Fix user_session_time table policies
DROP POLICY IF EXISTS "Users can view their own session time" ON public.user_session_time;
CREATE POLICY "Users can view their own session time"
  ON public.user_session_time FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own session time" ON public.user_session_time;
CREATE POLICY "Users can insert their own session time"
  ON public.user_session_time FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own session time" ON public.user_session_time;
CREATE POLICY "Users can update their own session time"
  ON public.user_session_time FOR UPDATE
  USING ((select auth.uid()) = user_id);

-- Fix board_visits table policies
DROP POLICY IF EXISTS "Users can view their own board visits" ON public.board_visits;
CREATE POLICY "Users can view their own board visits"
  ON public.board_visits FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own board visits" ON public.board_visits;
CREATE POLICY "Users can insert their own board visits"
  ON public.board_visits FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

-- Fix user_terms_acceptance table policies
DROP POLICY IF EXISTS "Users can view their own terms acceptance" ON public.user_terms_acceptance;
CREATE POLICY "Users can view their own terms acceptance"
  ON public.user_terms_acceptance FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own terms acceptance" ON public.user_terms_acceptance;
CREATE POLICY "Users can insert their own terms acceptance"
  ON public.user_terms_acceptance FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

-- Fix reports table policies
DROP POLICY IF EXISTS "Moderators can view all reports" ON public.reports;
CREATE POLICY "Moderators can view all reports"
  ON public.reports FOR SELECT
  USING (
    (select public.has_role(auth.uid(), 'admin'::app_role)) OR
    (select public.has_role(auth.uid(), 'moderator'::app_role))
  );

DROP POLICY IF EXISTS "Authenticated users can create reports" ON public.reports;
CREATE POLICY "Authenticated users can create reports"
  ON public.reports FOR INSERT
  WITH CHECK ((select auth.uid()) = reporter_id);

DROP POLICY IF EXISTS "Moderators can update reports" ON public.reports;
CREATE POLICY "Moderators can update reports"
  ON public.reports FOR UPDATE
  USING (
    (select public.has_role(auth.uid(), 'admin'::app_role)) OR
    (select public.has_role(auth.uid(), 'moderator'::app_role))
  );

-- Fix user_warnings table policies
DROP POLICY IF EXISTS "Moderators can view warnings" ON public.user_warnings;
CREATE POLICY "Moderators can view warnings"
  ON public.user_warnings FOR SELECT
  USING (
    (select public.has_role(auth.uid(), 'admin'::app_role)) OR
    (select public.has_role(auth.uid(), 'moderator'::app_role))
  );

DROP POLICY IF EXISTS "Moderators can create warnings" ON public.user_warnings;
CREATE POLICY "Moderators can create warnings"
  ON public.user_warnings FOR INSERT
  WITH CHECK (
    (select public.has_role(auth.uid(), 'admin'::app_role)) OR
    (select public.has_role(auth.uid(), 'moderator'::app_role))
  );

-- Fix user_bans table policies
DROP POLICY IF EXISTS "Moderators can view bans" ON public.user_bans;
CREATE POLICY "Moderators can view bans"
  ON public.user_bans FOR SELECT
  USING (
    (select public.has_role(auth.uid(), 'admin'::app_role)) OR
    (select public.has_role(auth.uid(), 'moderator'::app_role))
  );

DROP POLICY IF EXISTS "Moderators can create bans" ON public.user_bans;
CREATE POLICY "Moderators can create bans"
  ON public.user_bans FOR INSERT
  WITH CHECK (
    (select public.has_role(auth.uid(), 'admin'::app_role)) OR
    (select public.has_role(auth.uid(), 'moderator'::app_role))
  );

-- Add missing moderator policies that were not in original migration
DROP POLICY IF EXISTS "Moderators can view warnings" ON public.user_warnings;
CREATE POLICY "Moderators can view warnings"
  ON public.user_warnings FOR SELECT
  USING (
    (select public.has_role(auth.uid(), 'admin'::app_role)) OR
    (select public.has_role(auth.uid(), 'moderator'::app_role))
  );

DROP POLICY IF EXISTS "Moderators can create warnings" ON public.user_warnings;
CREATE POLICY "Moderators can create warnings"
  ON public.user_warnings FOR INSERT
  WITH CHECK (
    (select public.has_role(auth.uid(), 'admin'::app_role)) OR
    (select public.has_role(auth.uid(), 'moderator'::app_role))
  );

DROP POLICY IF EXISTS "Moderators can view bans" ON public.user_bans;
CREATE POLICY "Moderators can view bans"
  ON public.user_bans FOR SELECT
  USING (
    (select public.has_role(auth.uid(), 'admin'::app_role)) OR
    (select public.has_role(auth.uid(), 'moderator'::app_role))
  );

-- Fix conversations table policies
DROP POLICY IF EXISTS "Users can view their own conversations" ON public.conversations;
CREATE POLICY "Users can view their own conversations"
  ON public.conversations FOR SELECT
  USING ((select auth.uid()) = user1_id OR (select auth.uid()) = user2_id);

DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK ((select auth.uid()) = user1_id OR (select auth.uid()) = user2_id);

-- Fix messages table policies
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
CREATE POLICY "Users can view messages in their conversations"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations
      WHERE id = messages.conversation_id
      AND (user1_id = (select auth.uid()) OR user2_id = (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Users can send messages in their conversations" ON public.messages;
CREATE POLICY "Users can send messages in their conversations"
  ON public.messages FOR INSERT
  WITH CHECK (
    (select auth.uid()) = sender_id
    AND EXISTS (
      SELECT 1 FROM public.conversations
      WHERE id = messages.conversation_id
      AND (user1_id = (select auth.uid()) OR user2_id = (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Users can update their received messages" ON public.messages;
CREATE POLICY "Users can update their received messages"
  ON public.messages FOR UPDATE
  USING ((select auth.uid()) = recipient_id)
  WITH CHECK ((select auth.uid()) = recipient_id);

-- Fix privacy_settings table policies
-- Consolidate SELECT policies (both allow reading based on business logic)
DROP POLICY IF EXISTS "Users can view their own privacy settings" ON public.privacy_settings;
DROP POLICY IF EXISTS "Users can view others privacy settings" ON public.privacy_settings;
CREATE POLICY "Users can view privacy settings"
  ON public.privacy_settings FOR SELECT
  USING (true);  -- Allows viewing all privacy settings (existing business logic)

DROP POLICY IF EXISTS "Users can insert their own privacy settings" ON public.privacy_settings;
CREATE POLICY "Users can insert their own privacy settings"
  ON public.privacy_settings FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own privacy settings" ON public.privacy_settings;
CREATE POLICY "Users can update their own privacy settings"
  ON public.privacy_settings FOR UPDATE
  USING ((select auth.uid()) = user_id);

-- Fix user_settings_changes table policies
DROP POLICY IF EXISTS "Users can view their own settings changes" ON public.user_settings_changes;
CREATE POLICY "Users can view their own settings changes"
  ON public.user_settings_changes FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own settings changes" ON public.user_settings_changes;
CREATE POLICY "Users can insert their own settings changes"
  ON public.user_settings_changes FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

-- Fix thread_custom_message_visits table policies
DROP POLICY IF EXISTS "Users can view their own thread visits" ON public.thread_custom_message_visits;
CREATE POLICY "Users can view their own thread visits"
  ON public.thread_custom_message_visits FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own thread visits" ON public.thread_custom_message_visits;
CREATE POLICY "Users can insert their own thread visits"
  ON public.thread_custom_message_visits FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

-- Fix post_likes table policies
-- Consolidate multiple permissive policies into single policy with combined logic
DROP POLICY IF EXISTS "Everyone can view post likes" ON public.post_likes;
DROP POLICY IF EXISTS "Users can manage their own likes" ON public.post_likes;
CREATE POLICY "Users can view and manage post likes"
  ON public.post_likes FOR ALL
  USING (true)
  WITH CHECK ((select auth.uid()) = user_id);