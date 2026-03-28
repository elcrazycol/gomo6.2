-- Add achievements for likes system

-- Add achievements for giving likes (likes_given type)
INSERT INTO public.achievements (id, name, description, category, icon, achievement_type) VALUES
('likes_given_1', 'Щедрый', 'Поставил свой первый лайк', 'basic', '👍', 'likes_given'),
('likes_given_10', 'Дружелюбный', 'Поставил 10 лайков', 'basic', '🤝', 'likes_given'),
('likes_given_25', 'Популярный', 'Поставил 25 лайков', 'basic', '⭐', 'likes_given'),
('likes_given_50', 'Влиятельный', 'Поставил 50 лайков', 'social', '🌟', 'likes_given'),
('likes_given_100', 'Лидер мнений', 'Поставил 100 лайков', 'social', '👑', 'likes_given'),
('likes_given_250', 'Мастер поддержки', 'Поставил 250 лайков', 'rare', '💎', 'likes_given'),
('likes_given_500', 'Легенда форума', 'Поставил 500 лайков', 'rare', '🏆', 'likes_given'),
('likes_given_1000', 'Икона сообщества', 'Поставил 1000 лайков', 'mythic', '👼', 'likes_given')
ON CONFLICT (id) DO NOTHING;

-- Add achievements for receiving likes (likes_received type)
INSERT INTO public.achievements (id, name, description, category, icon, achievement_type) VALUES
('likes_received_1', 'Замеченный', 'Получил свой первый лайк', 'basic', '👀', 'likes_received'),
('likes_received_10', 'Популярный', 'Получил 10 лайков', 'basic', '🎯', 'likes_received'),
('likes_received_25', 'Уважаемый', 'Получил 25 лайков', 'basic', '🎖️', 'likes_received'),
('likes_received_50', 'Влиятельный', 'Получил 50 лайков', 'social', '🏅', 'likes_received'),
('likes_received_100', 'Лидер мнений', 'Получил 100 лайков', 'social', '👑', 'likes_received'),
('likes_received_250', 'Мастер сообщества', 'Получил 250 лайков', 'rare', '💎', 'likes_received'),
('likes_received_500', 'Легенда форума', 'Получил 500 лайков', 'rare', '🏆', 'likes_received'),
('likes_received_1000', 'Икона сообщества', 'Получил 1000 лайков', 'mythic', '👼', 'likes_received')
ON CONFLICT (id) DO NOTHING;

-- Update the award_achievement_with_level function to handle likes achievements
-- Add the likes_given and likes_received cases to the ORDER BY clause

-- First, let's create a function to get user's total likes given
CREATE OR REPLACE FUNCTION public.get_user_likes_given_count(user_uuid UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM public.post_likes WHERE user_id = user_uuid;
$$;

-- Function to get user's total likes received
CREATE OR REPLACE FUNCTION public.get_user_likes_received_count(user_uuid UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM public.post_likes pl
  JOIN public.posts p ON pl.post_id = p.id
  WHERE p.user_id = user_uuid;
$$;

-- Update the award_achievement_with_level function to include likes cases
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
      WHEN achievement_type = 'likes_given' THEN
        CASE id
          WHEN 'likes_given_1' THEN 1
          WHEN 'likes_given_10' THEN 2
          WHEN 'likes_given_25' THEN 3
          WHEN 'likes_given_50' THEN 4
          WHEN 'likes_given_100' THEN 5
          WHEN 'likes_given_250' THEN 6
          WHEN 'likes_given_500' THEN 7
          WHEN 'likes_given_1000' THEN 8
        END
      WHEN achievement_type = 'likes_received' THEN
        CASE id
          WHEN 'likes_received_1' THEN 1
          WHEN 'likes_received_10' THEN 2
          WHEN 'likes_received_25' THEN 3
          WHEN 'likes_received_50' THEN 4
          WHEN 'likes_received_100' THEN 5
          WHEN 'likes_received_250' THEN 6
          WHEN 'likes_received_500' THEN 7
          WHEN 'likes_received_1000' THEN 8
        END
    END
  LIMIT 1;

  -- Check if achievement exists
  IF NOT FOUND THEN
    RAISE NOTICE 'Achievement not found for type: %, level: %', _achievement_type, _level;
    RETURN;
  END IF;

  -- Check current level for this user and achievement type
  SELECT COALESCE(MAX(
    CASE
      WHEN achievement_type = 'time' THEN
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
      WHEN achievement_type = 'posts' THEN
        CASE ua.achievement_id
          WHEN 'posts_10' THEN 1
          WHEN 'posts_100' THEN 2
          WHEN 'posts_250' THEN 3
          WHEN 'posts_500' THEN 4
          WHEN 'posts_1000' THEN 5
          WHEN 'posts_2500' THEN 6
          WHEN 'posts_5000' THEN 7
        END
      WHEN achievement_type = 'threads' THEN
        CASE ua.achievement_id
          WHEN 'threads_5' THEN 1
          WHEN 'threads_10' THEN 2
          WHEN 'threads_25' THEN 3
          WHEN 'threads_50' THEN 4
          WHEN 'threads_80' THEN 5
          WHEN 'threads_100' THEN 6
        END
      WHEN achievement_type = 'likes_given' THEN
        CASE ua.achievement_id
          WHEN 'likes_given_1' THEN 1
          WHEN 'likes_given_10' THEN 2
          WHEN 'likes_given_25' THEN 3
          WHEN 'likes_given_50' THEN 4
          WHEN 'likes_given_100' THEN 5
          WHEN 'likes_given_250' THEN 6
          WHEN 'likes_given_500' THEN 7
          WHEN 'likes_given_1000' THEN 8
        END
      WHEN achievement_type = 'likes_received' THEN
        CASE ua.achievement_id
          WHEN 'likes_received_1' THEN 1
          WHEN 'likes_received_10' THEN 2
          WHEN 'likes_received_25' THEN 3
          WHEN 'likes_received_50' THEN 4
          WHEN 'likes_received_100' THEN 5
          WHEN 'likes_received_250' THEN 6
          WHEN 'likes_received_500' THEN 7
          WHEN 'likes_received_1000' THEN 8
        END
    END
  ), 0) INTO current_level
  FROM user_achievements ua
  JOIN achievements a ON ua.achievement_id = a.id
  WHERE ua.user_id = _user_id AND a.achievement_type = _achievement_type;

  -- Only award if this is a new level
  IF _level > current_level THEN
    -- Insert the achievement
    INSERT INTO user_achievements (user_id, achievement_id, unlocked_at, level)
    VALUES (_user_id, achievement_record.id, NOW(), _level)
    ON CONFLICT (user_id, achievement_id) DO UPDATE SET
      level = EXCLUDED.level,
      unlocked_at = CASE WHEN user_achievements.level < EXCLUDED.level THEN NOW() ELSE user_achievements.unlocked_at END;
  END IF;
END;
$$;

-- Function to create like notification
CREATE OR REPLACE FUNCTION public.notify_on_like()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  post_author_id UUID;
  liker_username TEXT;
  thread_id UUID;
BEGIN
  -- Get post author and thread info
  SELECT p.user_id, t.id INTO post_author_id, thread_id
  FROM posts p
  JOIN threads t ON p.thread_id = t.id
  WHERE p.id = NEW.post_id;

  -- Don't notify if user likes their own post
  IF post_author_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Get liker username
  SELECT username INTO liker_username
  FROM profiles
  WHERE id = NEW.user_id;

  -- Create notification
  INSERT INTO public.notifications (user_id, type, title, message, related_post_id, related_thread_id)
  VALUES (
    post_author_id,
    'like',
    'Новый лайк!',
    liker_username || ' оценил ваше сообщение',
    NEW.post_id,
    thread_id
  );

  RETURN NEW;
END;
$$;

-- Create trigger for like notifications
DROP TRIGGER IF EXISTS on_post_liked ON post_likes;
CREATE TRIGGER on_post_liked
  AFTER INSERT ON post_likes
  FOR EACH ROW
  EXECUTE FUNCTION notify_on_like();