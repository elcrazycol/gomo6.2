-- Thread Likes System - Complete Setup
-- Apply this SQL directly in Supabase SQL Editor

-- Clean up existing objects first
DROP TRIGGER IF EXISTS check_thread_likes_received_achievements_trigger ON thread_likes;
DROP TRIGGER IF EXISTS check_thread_likes_given_achievements_trigger ON thread_likes;
DROP FUNCTION IF EXISTS check_thread_likes_received_achievements();
DROP FUNCTION IF EXISTS check_thread_likes_given_achievements();
DROP FUNCTION IF EXISTS award_achievement_with_level(uuid, text, integer);
DROP FUNCTION IF EXISTS get_recent_thread_likers(uuid, integer);
DROP FUNCTION IF EXISTS has_user_liked_thread(uuid, uuid);
DROP FUNCTION IF EXISTS get_thread_likes_count(uuid);
DROP FUNCTION IF EXISTS get_user_thread_likes_received_count(uuid);
DROP FUNCTION IF EXISTS get_user_thread_likes_given_count(uuid);

-- 1. Create thread_likes table
DROP TABLE IF EXISTS public.thread_likes;
CREATE TABLE public.thread_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES public.threads(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(thread_id, user_id)
);

-- Create indexes
CREATE INDEX idx_thread_likes_thread_id ON public.thread_likes(thread_id);
CREATE INDEX idx_thread_likes_user_id ON public.thread_likes(user_id);
CREATE INDEX idx_thread_likes_created_at ON public.thread_likes(created_at DESC);

-- Enable RLS
ALTER TABLE public.thread_likes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Everyone can view thread likes" ON public.thread_likes
  FOR SELECT USING (true);

CREATE POLICY "Users can manage their own thread likes" ON public.thread_likes
  FOR ALL USING (auth.uid() = user_id);

-- 2. Functions
CREATE FUNCTION public.get_thread_likes_count(thread_uuid UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM public.thread_likes WHERE thread_id = thread_uuid;
$$;

CREATE FUNCTION public.get_recent_thread_likers(thread_uuid UUID, limit_count INTEGER DEFAULT 3)
RETURNS TABLE(username TEXT, id UUID, avatar_url TEXT, is_anonymous BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.username, p.id, p.avatar_url, p.is_anonymous
  FROM public.thread_likes tl
  JOIN public.profiles p ON tl.user_id = p.id
  WHERE tl.thread_id = thread_uuid
  ORDER BY tl.created_at DESC
  LIMIT limit_count;
$$;

CREATE FUNCTION public.has_user_liked_thread(thread_uuid UUID, user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.thread_likes
    WHERE thread_id = thread_uuid AND user_id = user_uuid
  );
$$;

CREATE FUNCTION public.get_user_thread_likes_received_count(user_uuid UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM public.thread_likes tl
  JOIN public.threads t ON tl.thread_id = t.id
  WHERE t.user_id = user_uuid;
$$;

CREATE FUNCTION public.get_user_thread_likes_given_count(user_uuid UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM public.thread_likes WHERE user_id = user_uuid;
$$;

-- 3. Thread Likes Achievements
INSERT INTO public.achievements (id, name, description, category, icon, achievement_type, reward_type, reward_value) VALUES
-- Thread likes received achievements
('thread_likes_received_1', 'Интересный тред', 'Первый лайк на тред', 'basic', '👍', 'thread_likes_received', null, null),
('thread_likes_received_10', 'Популярный автор', 'Получил 10 лайков на треды', 'basic', '🎯', 'thread_likes_received', null, null),
('thread_likes_received_25', 'Уважаемый', 'Получил 25 лайков на треды', 'basic', '🎖️', 'thread_likes_received', null, null),
('thread_likes_received_50', 'Влиятельный', 'Получил 50 лайков на треды', 'social', '🏅', 'thread_likes_received', null, null),
('thread_likes_received_75', 'Лидер мнений', 'Получил 75 лайков на треды', 'social', '👑', 'thread_likes_received', null, null),
('thread_likes_received_100', 'Мастер сообщества', 'Получил 100 лайков на треды', 'rare', '💎', 'thread_likes_received', null, null),
('thread_likes_received_250', 'Легенда форума', 'Получил 250 лайков на треды', 'rare', '🏆', 'thread_likes_received', null, null),
('thread_likes_received_500', 'Икона сообщества', 'Получил 500 лайков на треды', 'mythic', '👼', 'thread_likes_received', null, null),

-- Thread likes given achievements
('thread_likes_given_1', 'Первый лайк', 'Поставил первый лайк на тред', 'basic', '❤️', 'thread_likes_given', null, null),
('thread_likes_given_10', 'Активный участник', 'Поставил 10 лайков на треды', 'basic', '💝', 'thread_likes_given', null, null),
('thread_likes_given_25', 'Поддержка сообщества', 'Поставил 25 лайков на треды', 'basic', '💖', 'thread_likes_given', null, null),
('thread_likes_given_50', 'Голос сообщества', 'Поставил 50 лайков на треды', 'social', '💕', 'thread_likes_given', null, null),
('thread_likes_given_100', 'Защитник идей', 'Поставил 100 лайков на треды', 'social', '💗', 'thread_likes_given', null, null),
('thread_likes_given_250', 'Меценат', 'Поставил 250 лайков на треды', 'rare', '💘', 'thread_likes_given', null, null),
('thread_likes_given_500', 'Покровитель', 'Поставил 500 лайков на треды', 'mythic', '💞', 'thread_likes_given', null, null)
ON CONFLICT (id) DO NOTHING;

-- 4. Achievement Functions
CREATE FUNCTION public.award_achievement_with_level(
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
  DECLARE
    current_level INTEGER := 0;
  BEGIN
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
      -- Insert the achievement
      INSERT INTO public.user_achievements (user_id, achievement_id, level)
      VALUES (_user_id, local_achievement_id, _level)
      ON CONFLICT (user_id, achievement_id) DO UPDATE SET
        level = EXCLUDED.level,
        unlocked_at = CASE WHEN public.user_achievements.level < EXCLUDED.level THEN now() ELSE public.user_achievements.unlocked_at END;

      RAISE NOTICE 'Awarded achievement: % (level %) to user %', local_achievement_id, _level, _user_id;
    END IF;
  END;
END;
$$;

-- 5. Achievement Triggers
CREATE FUNCTION public.check_thread_likes_received_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  thread_author_id UUID;
  likes_count INTEGER;
  achievement_level INTEGER := 0;
BEGIN
  -- Get the thread author
  SELECT user_id INTO thread_author_id
  FROM public.threads
  WHERE id = NEW.thread_id;

  -- Don't award achievements for self-likes
  IF thread_author_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Get total likes received on threads by this user
  SELECT public.get_user_thread_likes_received_count(thread_author_id) INTO likes_count;

  -- Determine achievement level based on total likes received
  CASE
    WHEN likes_count >= 500 THEN achievement_level := 8;
    WHEN likes_count >= 250 THEN achievement_level := 7;
    WHEN likes_count >= 100 THEN achievement_level := 6;
    WHEN likes_count >= 75 THEN achievement_level := 5;
    WHEN likes_count >= 50 THEN achievement_level := 4;
    WHEN likes_count >= 25 THEN achievement_level := 3;
    WHEN likes_count >= 10 THEN achievement_level := 2;
    WHEN likes_count >= 1 THEN achievement_level := 1;
    ELSE achievement_level := 0;
  END CASE;

  -- Award achievement if level > 0
  IF achievement_level > 0 THEN
    PERFORM public.award_achievement_with_level(
      thread_author_id,
      'thread_likes_received',
      achievement_level
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.check_thread_likes_given_achievements()
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
  SELECT public.get_user_thread_likes_given_count(NEW.user_id) INTO likes_count;

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

  -- Award achievement if level > 0
  IF achievement_level > 0 THEN
    PERFORM public.award_achievement_with_level(
      NEW.user_id,
      'thread_likes_given',
      achievement_level
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create triggers (drop existing first)
DROP TRIGGER IF EXISTS check_thread_likes_received_achievements_trigger ON thread_likes;
DROP TRIGGER IF EXISTS check_thread_likes_given_achievements_trigger ON thread_likes;

CREATE TRIGGER check_thread_likes_received_achievements_trigger
  AFTER INSERT ON thread_likes
  FOR EACH ROW
  EXECUTE FUNCTION check_thread_likes_received_achievements();

CREATE TRIGGER check_thread_likes_given_achievements_trigger
  AFTER INSERT ON thread_likes
  FOR EACH ROW
  EXECUTE FUNCTION check_thread_likes_given_achievements();

-- Remove duplicate achievement notifications
-- The award_achievement_with_level function no longer creates notifications
-- to prevent duplicates with the notify_achievement trigger

-- Success message
SELECT 'Thread likes system successfully installed and notifications fixed!' as status;