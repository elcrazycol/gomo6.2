-- Fix duplicate achievement notifications
-- Remove manual notification creation from ALL achievement functions
-- to prevent duplicates with the notify_achievement trigger

-- 1. Update award_achievement_with_level function
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
  local_achievement_id TEXT;
  current_level INTEGER := 0;
BEGIN
  -- Map achievement type and level to achievement id
  IF _achievement_type = 'thread_likes_received' THEN
    local_achievement_id := CASE _level
      WHEN 1 THEN 'thread_likes_received_1'
      WHEN 2 THEN 'thread_likes_received_10'
      WHEN 3 THEN 'thread_likes_received_25'
      WHEN 4 THEN 'thread_likes_received_50'
      WHEN 5 THEN 'thread_likes_received_75'
      WHEN 6 THEN 'thread_likes_received_100'
      WHEN 7 THEN 'thread_likes_received_250'
      WHEN 8 THEN 'thread_likes_received_500'
      ELSE NULL
    END;
  ELSIF _achievement_type = 'thread_likes_given' THEN
    local_achievement_id := CASE _level
      WHEN 1 THEN 'thread_likes_given_1'
      WHEN 2 THEN 'thread_likes_given_10'
      WHEN 3 THEN 'thread_likes_given_25'
      WHEN 4 THEN 'thread_likes_given_50'
      WHEN 5 THEN 'thread_likes_given_100'
      WHEN 6 THEN 'thread_likes_given_250'
      WHEN 7 THEN 'thread_likes_given_500'
      ELSE NULL
    END;
  ELSE
    RAISE NOTICE 'Unknown achievement type: %', _achievement_type;
    RETURN;
  END IF;

  -- Check if achievement exists
  IF local_achievement_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.achievements WHERE id = local_achievement_id
  ) THEN
    RAISE NOTICE 'Achievement not found: %', local_achievement_id;
    RETURN;
  END IF;

  -- Check current level for this achievement type
  SELECT COALESCE(MAX(
    CASE _achievement_type
      WHEN 'thread_likes_received' THEN
        CASE ua.achievement_id
          WHEN 'thread_likes_received_1' THEN 1
          WHEN 'thread_likes_received_10' THEN 2
          WHEN 'thread_likes_received_25' THEN 3
          WHEN 'thread_likes_received_50' THEN 4
          WHEN 'thread_likes_received_75' THEN 5
          WHEN 'thread_likes_received_100' THEN 6
          WHEN 'thread_likes_received_250' THEN 7
          WHEN 'thread_likes_received_500' THEN 8
        END
      WHEN 'thread_likes_given' THEN
        CASE ua.achievement_id
          WHEN 'thread_likes_given_1' THEN 1
          WHEN 'thread_likes_given_10' THEN 2
          WHEN 'thread_likes_given_25' THEN 3
          WHEN 'thread_likes_given_50' THEN 4
          WHEN 'thread_likes_given_100' THEN 5
          WHEN 'thread_likes_given_250' THEN 6
          WHEN 'thread_likes_given_500' THEN 7
        END
    END
  ), 0) INTO current_level
  FROM public.user_achievements ua
  JOIN public.achievements a ON ua.achievement_id = a.id
  WHERE ua.user_id = _user_id AND a.achievement_type = _achievement_type;

  -- Only award if this is a new level
  IF _level > current_level THEN
    -- Insert the achievement (notification will be created by trigger)
    INSERT INTO public.user_achievements (user_id, achievement_id, level)
    VALUES (_user_id, local_achievement_id, _level)
    ON CONFLICT (user_id, achievement_id) DO UPDATE SET
      level = EXCLUDED.level,
      unlocked_at = CASE WHEN public.user_achievements.level < EXCLUDED.level THEN now() ELSE public.user_achievements.unlocked_at END;

    RAISE NOTICE 'Awarded achievement: % (level %) to user %', local_achievement_id, _level, _user_id;
  END IF;
END;
$$;

-- 2. Fix check_likes_received_achievements function (removes manual notifications)
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
  FROM public.posts
  WHERE id = NEW.post_id;

  -- Don't award achievements for self-likes
  IF post_author_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Get total likes received by this user
  SELECT public.get_user_likes_received_count(post_author_id) INTO likes_count;

  -- Determine achievement level based on total likes received
  CASE
    WHEN likes_count >= 1000 THEN achievement_level := 8;
    WHEN likes_count >= 500 THEN achievement_level := 7;
    WHEN likes_count >= 250 THEN achievement_level := 6;
    WHEN likes_count >= 100 THEN achievement_level := 5;
    WHEN likes_count >= 50 THEN achievement_level := 4;
    WHEN likes_count >= 25 THEN achievement_level := 3;
    WHEN likes_count >= 10 THEN achievement_level := 2;
    WHEN likes_count >= 1 THEN achievement_level := 1;
    ELSE achievement_level := 0;
  END CASE;

  -- Award achievement if level > 0 (notification created by trigger)
  IF achievement_level > 0 THEN
    PERFORM public.award_achievement_with_level(
      post_author_id,
      'likes_received',
      achievement_level
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Fix check_likes_given_achievements function (removes manual notifications)
CREATE OR REPLACE FUNCTION public.check_likes_given_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  likes_count INTEGER;
  achievement_level INTEGER := 0;
BEGIN
  -- Get total likes given by this user
  SELECT public.get_user_likes_given_count(NEW.user_id) INTO likes_count;

  -- Determine achievement level based on total likes given
  CASE
    WHEN likes_count >= 500 THEN achievement_level := 7;
    WHEN likes_count >= 250 THEN achievement_level := 6;
    WHEN likes_count >= 100 THEN achievement_level := 5;
    WHEN likes_count >= 50 THEN achievement_level := 4;
    WHEN likes_count >= 25 THEN achievement_level := 3;
    WHEN likes_count >= 10 THEN achievement_level := 2;
    WHEN likes_count >= 1 THEN achievement_level := 1;
    ELSE achievement_level := 0;
  END CASE;

  -- Award achievement if level > 0 (notification created by trigger)
  IF achievement_level > 0 THEN
    PERFORM public.award_achievement_with_level(
      NEW.user_id,
      'likes_given',
      achievement_level
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Fix check_image_upload_achievements function (removes manual notifications)
CREATE OR REPLACE FUNCTION public.check_image_upload_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  images_count INTEGER;
  achievement_level INTEGER := 0;
BEGIN
  -- Get total images uploaded by this user
  SELECT image_upload_count INTO images_count
  FROM public.profiles
  WHERE id = NEW.user_id;

  -- Determine achievement level based on total images
  CASE
    WHEN images_count >= 1000 THEN achievement_level := 5;
    WHEN images_count >= 250 THEN achievement_level := 4;
    WHEN images_count >= 100 THEN achievement_level := 3;
    WHEN images_count >= 25 THEN achievement_level := 2;
    WHEN images_count >= 10 THEN achievement_level := 1;
    ELSE achievement_level := 0;
  END CASE;

  -- Award achievement if level > 0 (notification created by trigger)
  IF achievement_level > 0 THEN
    PERFORM public.award_achievement_with_level(
      NEW.user_id,
      'images',
      achievement_level
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Fix check_post_count_achievements function (removes manual notifications)
CREATE OR REPLACE FUNCTION public.check_post_count_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  posts_count INTEGER;
  achievement_level INTEGER := 0;
BEGIN
  -- Get total posts by this user
  SELECT post_count INTO posts_count
  FROM public.profiles
  WHERE id = NEW.user_id;

  -- Determine achievement level based on total posts
  CASE
    WHEN posts_count >= 1000 THEN achievement_level := 5;
    WHEN posts_count >= 500 THEN achievement_level := 4;
    WHEN posts_count >= 100 THEN achievement_level := 3;
    WHEN posts_count >= 10 THEN achievement_level := 2;
    WHEN posts_count >= 1 THEN achievement_level := 1;
    ELSE achievement_level := 0;
  END CASE;

  -- Award achievement if level > 0 (notification created by trigger)
  IF achievement_level > 0 THEN
    PERFORM public.award_achievement_with_level(
      NEW.user_id,
      'posts',
      achievement_level
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Success message
SELECT 'ALL duplicate achievement notifications fixed! Now only triggers create notifications.' as status;