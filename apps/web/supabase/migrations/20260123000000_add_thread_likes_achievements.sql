-- Add achievements for thread likes (thread_likes_received and thread_likes_given types)
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

-- Update award_achievement_with_level to handle thread likes
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
  achievement_id TEXT;
BEGIN
  -- Map achievement type and level to achievement id
  IF _achievement_type = 'thread_likes_received' THEN
    achievement_id := CASE _level
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
    achievement_id := CASE _level
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
  IF achievement_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM achievements WHERE id = achievement_id
  ) THEN
    RAISE NOTICE 'Achievement not found: %', achievement_id;
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
    FROM user_achievements ua
    JOIN achievements a ON ua.achievement_id = a.id
    WHERE ua.user_id = _user_id AND a.achievement_type = _achievement_type;

    -- Only award if this is a new level
    IF _level > current_level THEN
      -- Insert the achievement
      INSERT INTO user_achievements (user_id, achievement_id, level)
      VALUES (_user_id, achievement_id, _level)
      ON CONFLICT (user_id, achievement_id) DO UPDATE SET
        level = EXCLUDED.level,
        unlocked_at = CASE WHEN user_achievements.level < EXCLUDED.level THEN now() ELSE user_achievements.unlocked_at END;

      -- Create notification
      INSERT INTO notifications (user_id, type, title, message, related_thread_id)
      SELECT
        _user_id,
        'achievement',
        'Новое достижение!',
        'Вы получили достижение: ' || a.name,
        NULL
      FROM achievements a
      WHERE a.id = achievement_id;

      RAISE NOTICE 'Awarded achievement: % (level %) to user %', achievement_id, _level, _user_id;
    END IF;
  END;
END;
$$;

-- Function to check thread likes received achievements
CREATE OR REPLACE FUNCTION public.check_thread_likes_received_achievements()
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

-- Function to check thread likes given achievements
CREATE OR REPLACE FUNCTION public.check_thread_likes_given_achievements()
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

-- Create triggers for thread likes achievements
DROP TRIGGER IF EXISTS check_thread_likes_received_achievements_trigger ON thread_likes;
CREATE TRIGGER check_thread_likes_received_achievements_trigger
  AFTER INSERT ON thread_likes
  FOR EACH ROW
  EXECUTE FUNCTION check_thread_likes_received_achievements();

DROP TRIGGER IF EXISTS check_thread_likes_given_achievements_trigger ON thread_likes;
CREATE TRIGGER check_thread_likes_given_achievements_trigger
  AFTER INSERT ON thread_likes
  FOR EACH ROW
  EXECUTE FUNCTION check_thread_likes_given_achievements();