-- Redesign achievements system to use levels instead of multiple achievements

-- Add level field to user_achievements
ALTER TABLE public.user_achievements
ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1;

-- Add achievement_type field to achievements for grouping
ALTER TABLE public.achievements
ADD COLUMN IF NOT EXISTS achievement_type TEXT;

-- Update existing achievements with types
UPDATE public.achievements SET achievement_type = 'time' WHERE category = 'time';
UPDATE public.achievements SET achievement_type = 'posts' WHERE id LIKE 'posts_%';
UPDATE public.achievements SET achievement_type = 'threads' WHERE id LIKE 'threads_%' OR id = 'first_thread';
UPDATE public.achievements SET achievement_type = 'posts' WHERE id IN ('first_text_post', 'first_image_post', 'double_post', 'posts_10', 'posts_100');
UPDATE public.achievements SET achievement_type = 'social' WHERE id LIKE 'thread_%' OR category = 'social';
UPDATE public.achievements SET achievement_type = 'rare' WHERE category = 'rare' OR category = 'mythic';
UPDATE public.achievements SET achievement_type = 'meme' WHERE category = 'meme';
UPDATE public.achievements SET achievement_type = 'behavior' WHERE category = 'behavior';
UPDATE public.achievements SET achievement_type = 'secret' WHERE category = 'secret';
UPDATE public.achievements SET achievement_type = 'activity' WHERE category = 'boards' OR id IN ('rules_reader', 'custom_message_thread', 'incel');
UPDATE public.achievements SET achievement_type = 'settings' WHERE id = 'font_customizer';

-- Set achievement_type for new achievements
UPDATE public.achievements SET achievement_type = 'time' WHERE id LIKE 'time_%';
UPDATE public.achievements SET achievement_type = 'posts' WHERE id LIKE 'posts_%';
UPDATE public.achievements SET achievement_type = 'threads' WHERE id LIKE 'threads_%';
UPDATE public.achievements SET achievement_type = 'settings' WHERE id = 'font_customizer';
UPDATE public.achievements SET achievement_type = 'activity' WHERE id IN ('rules_reader', 'custom_message_thread');

-- Create function to award achievements with levels
CREATE OR REPLACE FUNCTION public.award_achievement_with_level(
  _user_id uuid,
  _achievement_type text,
  _level integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  achievement_record RECORD;
  current_level INTEGER;
BEGIN
  -- Get the achievement record for this type and level
  SELECT * INTO achievement_record
  FROM achievements
  WHERE achievement_type = _achievement_type
  ORDER BY
    CASE
      WHEN achievement_type = 'time' THEN
        CASE id
          WHEN 'time_10min' THEN 1
          WHEN 'time_30min' THEN 2
          WHEN 'time_1hour' THEN 3
          WHEN 'time_5hours' THEN 4
          WHEN 'time_10hours' THEN 5
          WHEN 'time_25hours' THEN 6
          WHEN 'time_50hours' THEN 7
          WHEN 'time_100hours' THEN 8
          WHEN 'time_250hours' THEN 9
          WHEN 'time_500hours' THEN 10
        END
      WHEN achievement_type = 'posts' THEN
        CASE id
          WHEN 'posts_10' THEN 1
          WHEN 'posts_100' THEN 2
          WHEN 'posts_250' THEN 3
          WHEN 'posts_500' THEN 4
          WHEN 'posts_1000' THEN 5
          WHEN 'posts_2500' THEN 6
          WHEN 'posts_5000' THEN 7
        END
      WHEN achievement_type = 'threads' THEN
        CASE id
          WHEN 'threads_5' THEN 1
          WHEN 'threads_10' THEN 2
          WHEN 'threads_25' THEN 3
          WHEN 'threads_50' THEN 4
          WHEN 'threads_80' THEN 5
          WHEN 'threads_100' THEN 6
        END
      ELSE 1
    END
  LIMIT 1;

  IF NOT FOUND THEN
    -- If no specific achievement found, use the base one
    SELECT * INTO achievement_record
    FROM achievements
    WHERE achievement_type = _achievement_type
    LIMIT 1;
  END IF;

  -- Check current level
  SELECT level INTO current_level
  FROM user_achievements
  WHERE user_id = _user_id AND achievement_id = achievement_record.id;

  IF current_level IS NULL THEN
    -- First time achievement
    INSERT INTO user_achievements (user_id, achievement_id, level)
    VALUES (_user_id, achievement_record.id, _level);
  ELSIF _level > current_level THEN
    -- Upgrade level
    UPDATE user_achievements
    SET level = _level, unlocked_at = NOW()
    WHERE user_id = _user_id AND achievement_id = achievement_record.id;
  END IF;
END;
$$;

-- Update award_achievement function to handle backwards compatibility
CREATE OR REPLACE FUNCTION public.award_achievement(_user_id uuid, _achievement_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  achievement_type TEXT;
  level INTEGER := 1;
BEGIN
  -- Get achievement type
  SELECT a.achievement_type INTO achievement_type
  FROM achievements a
  WHERE a.id = _achievement_id;

  IF achievement_type IS NULL THEN
    -- Legacy achievement without type, use old logic
    INSERT INTO user_achievements (user_id, achievement_id, level)
    VALUES (_user_id, _achievement_id, 1)
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
    RETURN;
  END IF;

  -- Determine level based on achievement_id
  CASE
    WHEN _achievement_id LIKE 'time_%' THEN
      level := CASE _achievement_id
        WHEN 'time_10min' THEN 1
        WHEN 'time_30min' THEN 2
        WHEN 'time_1hour' THEN 3
        WHEN 'time_5hours' THEN 4
        WHEN 'time_10hours' THEN 5
        WHEN 'time_25hours' THEN 6
        WHEN 'time_50hours' THEN 7
        WHEN 'time_100hours' THEN 8
        WHEN 'time_250hours' THEN 9
        WHEN 'time_500hours' THEN 10
        ELSE 1
      END;
    WHEN _achievement_id LIKE 'posts_%' THEN
      level := CASE _achievement_id
        WHEN 'posts_10' THEN 1
        WHEN 'posts_100' THEN 2
        WHEN 'posts_250' THEN 3
        WHEN 'posts_500' THEN 4
        WHEN 'posts_1000' THEN 5
        WHEN 'posts_2500' THEN 6
        WHEN 'posts_5000' THEN 7
        ELSE 1
      END;
    WHEN _achievement_id LIKE 'threads_%' THEN
      level := CASE _achievement_id
        WHEN 'threads_5' THEN 1
        WHEN 'threads_10' THEN 2
        WHEN 'threads_25' THEN 3
        WHEN 'threads_50' THEN 4
        WHEN 'threads_80' THEN 5
        WHEN 'threads_100' THEN 6
        ELSE 1
      END;
    ELSE
      level := 1;
  END CASE;

  -- Use new function
  PERFORM award_achievement_with_level(_user_id, achievement_type, level);
END;
$$;

-- Update time-based achievement checking in useSessionTime hook
-- This will be handled in the frontend code

-- Update post count achievement checking
CREATE OR REPLACE FUNCTION public.check_post_count_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  post_count INTEGER;
  achievement_level INTEGER := 1;
BEGIN
  -- Get user's post count
  SELECT COALESCE(p.post_count, 0) INTO post_count
  FROM profiles p
  WHERE p.id = NEW.user_id;

  -- Determine level based on post count
  IF post_count >= 5000 THEN
    achievement_level := 7;
  ELSIF post_count >= 2500 THEN
    achievement_level := 6;
  ELSIF post_count >= 1000 THEN
    achievement_level := 5;
  ELSIF post_count >= 500 THEN
    achievement_level := 4;
  ELSIF post_count >= 250 THEN
    achievement_level := 3;
  ELSIF post_count >= 100 THEN
    achievement_level := 2;
  ELSIF post_count >= 10 THEN
    achievement_level := 1;
  END IF;

  IF achievement_level >= 1 THEN
    PERFORM award_achievement_with_level(NEW.user_id, 'posts', achievement_level);
  END IF;

  RETURN NEW;
END;
$$;

-- Update thread count achievement checking
CREATE OR REPLACE FUNCTION public.check_thread_count_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  thread_count INTEGER;
  achievement_level INTEGER := 1;
BEGIN
  -- Get user's thread count
  SELECT COALESCE(p.thread_count, 0) INTO thread_count
  FROM profiles p
  WHERE p.id = NEW.user_id;

  -- Determine level based on thread count
  IF thread_count >= 100 THEN
    achievement_level := 6;
  ELSIF thread_count >= 80 THEN
    achievement_level := 5;
  ELSIF thread_count >= 50 THEN
    achievement_level := 4;
  ELSIF thread_count >= 25 THEN
    achievement_level := 3;
  ELSIF thread_count >= 10 THEN
    achievement_level := 2;
  ELSIF thread_count >= 5 THEN
    achievement_level := 1;
  END IF;

  IF achievement_level >= 1 THEN
    PERFORM award_achievement_with_level(NEW.user_id, 'threads', achievement_level);
  END IF;

  RETURN NEW;
END;
$$;

-- Update time-based achievement checking
CREATE OR REPLACE FUNCTION public.check_time_based_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  total_minutes INTEGER;
  achievement_level INTEGER := 1;
BEGIN
  -- Get user's total time
  SELECT COALESCE(st.total_minutes, 0) INTO total_minutes
  FROM user_session_time st
  WHERE st.user_id = NEW.user_id;

  -- Determine level based on time
  IF total_minutes >= 30000 THEN -- 500 hours
    achievement_level := 10;
  ELSIF total_minutes >= 15000 THEN -- 250 hours
    achievement_level := 9;
  ELSIF total_minutes >= 6000 THEN -- 100 hours
    achievement_level := 8;
  ELSIF total_minutes >= 3000 THEN -- 50 hours
    achievement_level := 7;
  ELSIF total_minutes >= 1500 THEN -- 25 hours
    achievement_level := 6;
  ELSIF total_minutes >= 600 THEN -- 10 hours
    achievement_level := 5;
  ELSIF total_minutes >= 300 THEN -- 5 hours
    achievement_level := 4;
  ELSIF total_minutes >= 60 THEN -- 1 hour
    achievement_level := 3;
  ELSIF total_minutes >= 30 THEN -- 30 min
    achievement_level := 2;
  ELSIF total_minutes >= 10 THEN -- 10 min
    achievement_level := 1;
  END IF;

  IF achievement_level >= 1 THEN
    PERFORM award_achievement_with_level(NEW.user_id, 'time', achievement_level);
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger for time-based achievements
CREATE TRIGGER check_time_based_achievements_trigger
  AFTER UPDATE OF total_minutes ON user_session_time
  FOR EACH ROW
  EXECUTE FUNCTION check_time_based_achievements();

-- Update existing data to use levels
-- This will migrate existing achievements to the new system
UPDATE user_achievements ua
SET level = CASE
  WHEN ua.achievement_id LIKE 'time_%' THEN
    CASE ua.achievement_id
      WHEN 'time_10min' THEN 1
      WHEN 'time_30min' THEN 2
      WHEN 'time_1hour' THEN 3
      WHEN 'time_5hours' THEN 4
      WHEN 'time_10hours' THEN 5
      WHEN 'time_25hours' THEN 6
      WHEN 'time_50hours' THEN 7
      WHEN 'time_100hours' THEN 8
      WHEN 'time_250hours' THEN 9
      WHEN 'time_500hours' THEN 10
    END
  WHEN ua.achievement_id LIKE 'posts_%' THEN
    CASE ua.achievement_id
      WHEN 'posts_10' THEN 1
      WHEN 'posts_100' THEN 2
      WHEN 'posts_250' THEN 3
      WHEN 'posts_500' THEN 4
      WHEN 'posts_1000' THEN 5
      WHEN 'posts_2500' THEN 6
      WHEN 'posts_5000' THEN 7
    END
  WHEN ua.achievement_id LIKE 'threads_%' THEN
    CASE ua.achievement_id
      WHEN 'threads_5' THEN 1
      WHEN 'threads_10' THEN 2
      WHEN 'threads_25' THEN 3
      WHEN 'threads_50' THEN 4
      WHEN 'threads_80' THEN 5
      WHEN 'threads_100' THEN 6
    END
  ELSE 1
END
WHERE ua.level IS NULL;

-- Clean up duplicate achievements (keep only the highest level for each type)
DELETE FROM user_achievements ua1
WHERE EXISTS (
  SELECT 1 FROM user_achievements ua2
  WHERE ua2.user_id = ua1.user_id
    AND ua2.achievement_id IN (
      SELECT id FROM achievements WHERE achievement_type = (
        SELECT achievement_type FROM achievements WHERE id = ua1.achievement_id
      )
    )
    AND ua2.level > ua1.level
);