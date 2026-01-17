-- Fix achievement levels and grouping to show only highest level per type
-- This migration:
-- 1. Adds image achievements with levels
-- 2. Updates likes_received achievements to have proper levels (1, 10, 25, 50, 100, 250, 500, 1000)
-- 3. Ensures all achievement types work with level system

-- First, add image achievements with levels
INSERT INTO public.achievements (id, name, description, category, icon, achievement_type, reward_type, reward_value) VALUES
('images_1', 'Фотограф-новичок', 'Загрузил первое изображение', 'basic', '🖼️', 'images', null, null),
('images_10', 'Коллекционер', 'Загрузил 10 изображений', 'basic', '📸', 'images', null, null),
('images_25', 'Фотолюбитель', 'Загрузил 25 изображений', 'basic', '📷', 'images', null, null),
('images_50', 'Фотограф', 'Загрузил 50 изображений', 'social', '🎞️', 'images', null, null),
('images_100', 'Мастер фотографии', 'Загрузил 100 изображений', 'rare', '📹', 'images', null, null),
('images_250', 'Профессионал', 'Загрузил 250 изображений', 'rare', '🎬', 'images', null, null),
('images_500', 'Легенда фотографии', 'Загрузил 500 изображений', 'mythic', '🎥', 'images', null, null),
('images_1000', 'Икона фотографии', 'Загрузил 1000 изображений', 'legendary', '🌟', 'images', null, null)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  achievement_type = EXCLUDED.achievement_type,
  reward_type = EXCLUDED.reward_type,
  reward_value = EXCLUDED.reward_value;

-- Update existing image achievements to use images type
UPDATE public.achievements 
SET achievement_type = 'images'
WHERE id IN ('first_image_post', 'images_10', 'photographer');

-- Update award_achievement_with_level to handle images and likes_received
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
  target_achievement_id TEXT;
  new_achievement BOOLEAN := false;
BEGIN
  -- Determine achievement_id based on type and level
  target_achievement_id := CASE _achievement_type
    WHEN 'posts' THEN
      CASE _level
        WHEN 1 THEN 'posts_10'
        WHEN 2 THEN 'posts_25'
        WHEN 3 THEN 'posts_50'
        WHEN 4 THEN 'posts_75'
        WHEN 5 THEN 'posts_100'
        WHEN 6 THEN 'posts_150'
        WHEN 7 THEN 'posts_200'
        WHEN 8 THEN 'posts_250'
        WHEN 9 THEN 'posts_300'
        WHEN 10 THEN 'posts_350'
        WHEN 11 THEN 'posts_400'
        WHEN 12 THEN 'posts_500'
        WHEN 13 THEN 'posts_600'
        WHEN 14 THEN 'posts_700'
        WHEN 15 THEN 'posts_800'
        WHEN 16 THEN 'posts_900'
        WHEN 17 THEN 'posts_1000'
        ELSE NULL
      END
    WHEN 'threads' THEN
      CASE _level
        WHEN 1 THEN 'threads_5'
        WHEN 2 THEN 'threads_10'
        WHEN 3 THEN 'threads_25'
        WHEN 4 THEN 'threads_50'
        WHEN 5 THEN 'threads_80'
        WHEN 6 THEN 'threads_100'
        ELSE NULL
      END
    WHEN 'time' THEN
      CASE _level
        WHEN 1 THEN 'time_10min'
        WHEN 2 THEN 'time_30min'
        WHEN 3 THEN 'time_1hour'
        WHEN 4 THEN 'time_5hours'
        WHEN 5 THEN 'time_10hours'
        WHEN 6 THEN 'time_25hours'
        WHEN 7 THEN 'time_50hours'
        WHEN 8 THEN 'time_100hours'
        WHEN 9 THEN 'time_250hours'
        WHEN 10 THEN 'time_500hours'
        ELSE NULL
      END
    WHEN 'images' THEN
      CASE _level
        WHEN 1 THEN 'images_1'
        WHEN 2 THEN 'images_10'
        WHEN 3 THEN 'images_25'
        WHEN 4 THEN 'images_50'
        WHEN 5 THEN 'images_100'
        WHEN 6 THEN 'images_250'
        WHEN 7 THEN 'images_500'
        WHEN 8 THEN 'images_1000'
        ELSE NULL
      END
    WHEN 'likes_received' THEN
      CASE _level
        WHEN 1 THEN 'likes_received_1'
        WHEN 2 THEN 'likes_received_10'
        WHEN 3 THEN 'likes_received_25'
        WHEN 4 THEN 'likes_received_50'
        WHEN 5 THEN 'likes_received_100'
        WHEN 6 THEN 'likes_received_250'
        WHEN 7 THEN 'likes_received_500'
        WHEN 8 THEN 'likes_received_1000'
        ELSE NULL
      END
    WHEN 'likes_given' THEN
      CASE _level
        WHEN 1 THEN 'likes_given_1'
        WHEN 2 THEN 'likes_given_10'
        WHEN 3 THEN 'likes_given_25'
        WHEN 4 THEN 'likes_given_50'
        WHEN 5 THEN 'likes_given_100'
        WHEN 6 THEN 'likes_given_250'
        WHEN 7 THEN 'likes_given_500'
        WHEN 8 THEN 'likes_given_1000'
        ELSE NULL
      END
    ELSE NULL
  END;

  IF target_achievement_id IS NULL THEN
    RETURN;
  END IF;

  -- Get the achievement record
  SELECT * INTO achievement_record
  FROM achievements
  WHERE id = target_achievement_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Check current level
  SELECT ua.level INTO current_level
  FROM user_achievements ua
  WHERE ua.user_id = _user_id AND ua.achievement_id = achievement_record.id;

  IF current_level IS NULL THEN
    -- First time achievement
    INSERT INTO user_achievements (user_id, achievement_id, level)
    VALUES (_user_id, achievement_record.id, _level);
    new_achievement := true;
  ELSIF _level > current_level THEN
    -- Upgrade level (preserve pinned status and order)
    UPDATE user_achievements ua
    SET level = _level, unlocked_at = NOW()
    WHERE ua.user_id = _user_id AND ua.achievement_id = achievement_record.id;
    new_achievement := true;
  END IF;

  -- Note: Notifications are created by the notify_achievement_trigger on INSERT only.
END;
$$;

-- Function to check image upload achievements
CREATE OR REPLACE FUNCTION public.check_image_upload_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  image_count INTEGER;
  achievement_level INTEGER := 0;
BEGIN
  -- Only check if image_url or image_urls is present
  IF NEW.image_url IS NULL AND (NEW.image_urls IS NULL OR (NEW.image_urls::text = '[]'::text)) THEN
    RETURN NEW;
  END IF;

  -- Count unique images uploaded by user
  -- Handle both image_url (single) and image_urls (array)
  WITH all_user_images AS (
    SELECT DISTINCT image_url as img_url 
    FROM posts 
    WHERE user_id = NEW.user_id AND image_url IS NOT NULL
    UNION
    SELECT DISTINCT jsonb_array_elements_text(image_urls) as img_url 
    FROM posts 
    WHERE user_id = NEW.user_id 
      AND image_urls IS NOT NULL 
      AND jsonb_array_length(image_urls) > 0
  )
  SELECT COUNT(*) INTO image_count
  FROM all_user_images;

  -- Determine level based on image count
  IF image_count >= 1000 THEN
    achievement_level := 8;
  ELSIF image_count >= 500 THEN
    achievement_level := 7;
  ELSIF image_count >= 250 THEN
    achievement_level := 6;
  ELSIF image_count >= 100 THEN
    achievement_level := 5;
  ELSIF image_count >= 50 THEN
    achievement_level := 4;
  ELSIF image_count >= 25 THEN
    achievement_level := 3;
  ELSIF image_count >= 10 THEN
    achievement_level := 2;
  ELSIF image_count >= 1 THEN
    achievement_level := 1;
  END IF;

  IF achievement_level >= 1 THEN
    -- Award the achievement
    PERFORM award_achievement_with_level(NEW.user_id, 'images', achievement_level);
  END IF;

  RETURN NEW;
END;
$$;

-- Function to check likes received achievements
CREATE OR REPLACE FUNCTION public.check_likes_received_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  post_author_id UUID;
  likes_count INTEGER;
  achievement_level INTEGER := 0;
BEGIN
  -- Get the post author
  SELECT user_id INTO post_author_id
  FROM posts
  WHERE id = NEW.post_id;

  IF post_author_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count all likes received by the post author across all their posts
  SELECT COALESCE(COUNT(*), 0) INTO likes_count
  FROM post_likes pl
  JOIN posts p ON pl.post_id = p.id
  WHERE p.user_id = post_author_id;

  -- Determine level based on likes count
  IF likes_count >= 1000 THEN
    achievement_level := 8;
  ELSIF likes_count >= 500 THEN
    achievement_level := 7;
  ELSIF likes_count >= 250 THEN
    achievement_level := 6;
  ELSIF likes_count >= 100 THEN
    achievement_level := 5;
  ELSIF likes_count >= 50 THEN
    achievement_level := 4;
  ELSIF likes_count >= 25 THEN
    achievement_level := 3;
  ELSIF likes_count >= 10 THEN
    achievement_level := 2;
  ELSIF likes_count >= 1 THEN
    achievement_level := 1;
  END IF;

  IF achievement_level >= 1 THEN
    -- Award the achievement to the post author
    PERFORM award_achievement_with_level(
      post_author_id,
      'likes_received',
      achievement_level
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create or replace triggers
DROP TRIGGER IF EXISTS check_image_upload_achievements_trigger ON posts;
CREATE TRIGGER check_image_upload_achievements_trigger
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION check_image_upload_achievements();

DROP TRIGGER IF EXISTS check_likes_received_achievements_trigger ON post_likes;
CREATE TRIGGER check_likes_received_achievements_trigger
  AFTER INSERT ON post_likes
  FOR EACH ROW
  EXECUTE FUNCTION check_likes_received_achievements();

-- Migrate existing image achievements to new system
-- Convert first_image_post to images_1 level 1
UPDATE user_achievements ua
SET achievement_id = 'images_1', level = 1
WHERE ua.achievement_id = 'first_image_post';

-- Convert images_10 to images_10 level 2
UPDATE user_achievements ua
SET achievement_id = 'images_10', level = 2
WHERE ua.achievement_id = 'images_10';

-- Convert photographer to images_100 level 5
UPDATE user_achievements ua
SET achievement_id = 'images_100', level = 5
WHERE ua.achievement_id = 'photographer';

-- Delete old image achievements that are no longer needed
DELETE FROM achievements WHERE id IN ('first_image_post', 'photographer') AND id NOT IN (
  SELECT DISTINCT achievement_id FROM user_achievements WHERE achievement_id IN ('first_image_post', 'photographer')
);

-- Note: The profile page will be updated to show only the highest level per achievement type
