-- Fix achievement levels calculation based on actual user data

-- First, let's see what achievements users currently have
-- This will help us understand what needs to be recalculated

-- Function to recalculate all achievement levels for a user
CREATE OR REPLACE FUNCTION public.recalculate_user_achievement_levels(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_stats RECORD;
  time_level INTEGER := 0;
  posts_level INTEGER := 0;
  threads_level INTEGER := 0;
BEGIN
  -- Get comprehensive user stats
  SELECT
    COALESCE(p.post_count, 0) as post_count,
    COALESCE(p.thread_count, 0) as thread_count,
    COALESCE(st.total_minutes, 0) as total_minutes
  INTO user_stats
  FROM profiles p
  LEFT JOIN user_session_time st ON st.user_id = p.id
  WHERE p.id = _user_id;

  -- Calculate time level
  IF user_stats.total_minutes >= 30000 THEN -- 500 hours
    time_level := 10;
  ELSIF user_stats.total_minutes >= 15000 THEN -- 250 hours
    time_level := 9;
  ELSIF user_stats.total_minutes >= 6000 THEN -- 100 hours
    time_level := 8;
  ELSIF user_stats.total_minutes >= 3000 THEN -- 50 hours
    time_level := 7;
  ELSIF user_stats.total_minutes >= 1500 THEN -- 25 hours
    time_level := 6;
  ELSIF user_stats.total_minutes >= 600 THEN -- 10 hours
    time_level := 5;
  ELSIF user_stats.total_minutes >= 300 THEN -- 5 hours
    time_level := 4;
  ELSIF user_stats.total_minutes >= 60 THEN -- 1 hour
    time_level := 3;
  ELSIF user_stats.total_minutes >= 30 THEN -- 30 min
    time_level := 2;
  ELSIF user_stats.total_minutes >= 10 THEN -- 10 min
    time_level := 1;
  END IF;

  -- Calculate posts level
  IF user_stats.post_count >= 5000 THEN
    posts_level := 7;
  ELSIF user_stats.post_count >= 2500 THEN
    posts_level := 6;
  ELSIF user_stats.post_count >= 1000 THEN
    posts_level := 5;
  ELSIF user_stats.post_count >= 500 THEN
    posts_level := 4;
  ELSIF user_stats.post_count >= 250 THEN
    posts_level := 3;
  ELSIF user_stats.post_count >= 100 THEN
    posts_level := 2;
  ELSIF user_stats.post_count >= 10 THEN
    posts_level := 1;
  END IF;

  -- Calculate threads level
  IF user_stats.thread_count >= 100 THEN
    threads_level := 6;
  ELSIF user_stats.thread_count >= 80 THEN
    threads_level := 5;
  ELSIF user_stats.thread_count >= 50 THEN
    threads_level := 4;
  ELSIF user_stats.thread_count >= 25 THEN
    threads_level := 3;
  ELSIF user_stats.thread_count >= 10 THEN
    threads_level := 2;
  ELSIF user_stats.thread_count >= 5 THEN
    threads_level := 1;
  END IF;

  -- Update achievements with proper base achievements
  -- Time achievement - always use time_10min as base
  IF time_level > 0 THEN
    UPDATE user_achievements
    SET level = time_level, unlocked_at = NOW()
    WHERE user_id = _user_id AND achievement_id = 'time_10min';
    IF NOT FOUND THEN
      INSERT INTO user_achievements (user_id, achievement_id, level)
      VALUES (_user_id, 'time_10min', time_level);
    END IF;
  END IF;

  -- Posts achievement - always use posts_10 as base
  IF posts_level > 0 THEN
    UPDATE user_achievements
    SET level = posts_level, unlocked_at = NOW()
    WHERE user_id = _user_id AND achievement_id = 'posts_10';
    IF NOT FOUND THEN
      INSERT INTO user_achievements (user_id, achievement_id, level)
      VALUES (_user_id, 'posts_10', posts_level);
    END IF;
  END IF;

  -- Threads achievement - always use threads_5 as base
  IF threads_level > 0 THEN
    UPDATE user_achievements
    SET level = threads_level, unlocked_at = NOW()
    WHERE user_id = _user_id AND achievement_id = 'threads_5';
    IF NOT FOUND THEN
      INSERT INTO user_achievements (user_id, achievement_id, level)
      VALUES (_user_id, 'threads_5', threads_level);
    END IF;
  END IF;

  -- Update other achievements that don't depend on counts
  -- Font customizer
  IF EXISTS (SELECT 1 FROM user_settings_changes WHERE user_id = _user_id AND setting_name = 'custom_font') THEN
    UPDATE user_achievements
    SET level = 1, unlocked_at = NOW()
    WHERE user_id = _user_id AND achievement_id = 'font_customizer';
    IF NOT FOUND THEN
      INSERT INTO user_achievements (user_id, achievement_id, level)
      VALUES (_user_id, 'font_customizer', 1);
    END IF;
  END IF;

  -- Rules reader (if visited rules thread)
  IF EXISTS (SELECT 1 FROM thread_custom_message_visits tcmv
             JOIN threads t ON tcmv.thread_id = t.id
             WHERE tcmv.user_id = _user_id AND t.board_id IN (
               SELECT id FROM boards WHERE is_rules_board = true
             )) THEN
    UPDATE user_achievements
    SET level = 1, unlocked_at = NOW()
    WHERE user_id = _user_id AND achievement_id = 'rules_reader';
    IF NOT FOUND THEN
      INSERT INTO user_achievements (user_id, achievement_id, level)
      VALUES (_user_id, 'rules_reader', 1);
    END IF;
  END IF;

  -- Custom message thread visitor
  IF EXISTS (SELECT 1 FROM thread_custom_message_visits tcmv
             JOIN threads t ON tcmv.thread_id = t.id
             WHERE tcmv.user_id = _user_id AND t.custom_message IS NOT NULL AND t.custom_message != '') THEN
    UPDATE user_achievements
    SET level = 1, unlocked_at = NOW()
    WHERE user_id = _user_id AND achievement_id = 'custom_message_thread';
    IF NOT FOUND THEN
      INSERT INTO user_achievements (user_id, achievement_id, level)
      VALUES (_user_id, 'custom_message_thread', 1);
    END IF;
  END IF;

END;
$$;

-- Function to recalculate levels for all users
CREATE OR REPLACE FUNCTION public.recalculate_all_achievement_levels()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_record RECORD;
BEGIN
  -- Loop through all users who have achievements
  FOR user_record IN
    SELECT DISTINCT user_id FROM user_achievements
  LOOP
    PERFORM recalculate_user_achievement_levels(user_record.user_id);
  END LOOP;

  RAISE NOTICE 'Recalculated achievement levels for all users';
END;
$$;

-- Ensure base achievements have correct achievement_type
UPDATE achievements SET achievement_type = 'time' WHERE id = 'time_10min';
UPDATE achievements SET achievement_type = 'posts' WHERE id = 'posts_10';
UPDATE achievements SET achievement_type = 'threads' WHERE id = 'threads_5';
UPDATE achievements SET achievement_type = 'settings' WHERE id = 'font_customizer';
UPDATE achievements SET achievement_type = 'activity' WHERE id IN ('rules_reader', 'custom_message_thread');

-- Clear existing level data to force recalculation
-- But keep the achievement records, just reset levels
UPDATE user_achievements SET level = 1 WHERE level IS NOT NULL;

-- Clean up duplicate achievements (keep only base achievements per type per user)
DELETE FROM user_achievements ua1
WHERE EXISTS (
  SELECT 1 FROM user_achievements ua2
  WHERE ua2.user_id = ua1.user_id
    AND ua2.achievement_id IN ('time_10min', 'posts_10', 'threads_5', 'font_customizer', 'rules_reader', 'custom_message_thread')
    AND ua2.achievement_id != ua1.achievement_id
    AND ua2.achievement_id IN (
      SELECT
        CASE
          WHEN ua1.achievement_id LIKE 'time_%' THEN 'time_10min'
          WHEN ua1.achievement_id LIKE 'posts_%' THEN 'posts_10'
          WHEN ua1.achievement_id LIKE 'threads_%' THEN 'threads_5'
          ELSE ua1.achievement_id
        END
    )
);

-- Now recalculate levels for all users based on their actual stats
SELECT recalculate_all_achievement_levels();

-- Also, let's make sure the triggers are working for future updates
-- The existing triggers should handle new achievements correctly

-- Optional: Create a view to see achievement levels easily
CREATE OR REPLACE VIEW public.user_achievement_levels AS
SELECT
  ua.user_id,
  a.achievement_type,
  a.name,
  a.icon,
  a.description,
  ua.level,
  ua.unlocked_at
FROM user_achievements ua
JOIN achievements a ON ua.achievement_id = a.id
ORDER BY ua.user_id, a.achievement_type, ua.level DESC;