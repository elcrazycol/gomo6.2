-- Fix achievement triggers to use correct achievement IDs
DROP TRIGGER IF EXISTS check_post_achievements ON posts;
DROP TRIGGER IF EXISTS check_thread_achievements ON threads;
DROP TRIGGER IF EXISTS check_image_achievements ON posts;

-- Recreate award_achievement function (keeping it as is)
CREATE OR REPLACE FUNCTION public.award_achievement(_user_id uuid, _achievement_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO user_achievements (user_id, achievement_id)
  VALUES (_user_id, _achievement_id)
  ON CONFLICT (user_id, achievement_id) DO NOTHING;
END;
$$;

-- Updated function to check post achievements with correct IDs
CREATE OR REPLACE FUNCTION public.check_first_post_achievement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  post_count INTEGER;
BEGIN
  -- Count total posts by user
  SELECT COUNT(*) INTO post_count FROM posts WHERE user_id = NEW.user_id;
  
  -- Award first text post achievement
  IF post_count = 1 THEN
    PERFORM award_achievement(NEW.user_id, 'first_text_post');
  END IF;
  
  -- Check for 10 posts
  IF post_count = 10 THEN
    PERFORM award_achievement(NEW.user_id, 'posts_10');
  END IF;
  
  -- Check for 100 posts
  IF post_count = 100 THEN
    PERFORM award_achievement(NEW.user_id, 'posts_100');
  END IF;
  
  RETURN NEW;
END;
$$;

-- Updated function to check thread achievements with correct IDs
CREATE OR REPLACE FUNCTION public.check_first_thread_achievement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM award_achievement(NEW.user_id, 'first_thread');
  RETURN NEW;
END;
$$;

-- Updated function to check image achievements with correct IDs
CREATE OR REPLACE FUNCTION public.check_image_achievement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.image_url IS NOT NULL THEN
    PERFORM award_achievement(NEW.user_id, 'first_image_post');
  END IF;
  RETURN NEW;
END;
$$;

-- Recreate triggers
CREATE TRIGGER check_post_achievements
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION check_first_post_achievement();

CREATE TRIGGER check_thread_achievements
  AFTER INSERT ON threads
  FOR EACH ROW
  EXECUTE FUNCTION check_first_thread_achievement();

CREATE TRIGGER check_image_achievements
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION check_image_achievement();