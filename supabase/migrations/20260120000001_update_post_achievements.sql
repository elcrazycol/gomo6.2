-- Update post achievements system with new levels and colors

-- First, delete existing post achievements
DELETE FROM user_achievements WHERE achievement_id LIKE 'posts_%';
DELETE FROM achievements WHERE id LIKE 'posts_%';

-- Add new post count achievements with updated colors and levels
INSERT INTO public.achievements (id, name, description, category, icon, achievement_type, reward_type, reward_value) VALUES
('posts_10', 'Новичок', 'Написал 10 сообщений', 'basic', '💬', 'posts', 'username_color', 'gray'),
('posts_25', 'Болтун', 'Написал 25 сообщений', 'basic', '🗣️', 'posts', 'username_color', 'cyan'),
('posts_50', 'Разговорчивый', 'Написал 50 сообщений', 'basic', '📢', 'posts', 'username_color', 'green'),
('posts_75', 'Коммуникатор', 'Написал 75 сообщений', 'basic', '💭', 'posts', 'username_color', 'yellow'),
('posts_100', 'Активный', 'Написал 100 сообщений', 'basic', '🔥', 'posts', 'username_color', 'orange'),
('posts_150', 'Дискуссионер', 'Написал 150 сообщений', 'social', '💡', 'posts', 'username_color', 'red'),
('posts_200', 'Ведущий', 'Написал 200 сообщений', 'social', '⭐', 'posts', 'username_color', 'purple'),
('posts_250', 'Модератор', 'Написал 250 сообщений', 'social', '🛡️', 'posts', 'username_color', 'blue'),
('posts_300', 'Эксперт', 'Написал 300 сообщений', 'rare', '🎓', 'posts', 'username_color', 'gold'),
('posts_350', 'Мастер', 'Написал 350 сообщений', 'rare', '🏆', 'posts', 'username_color', 'silver'),
('posts_400', 'Легенда', 'Написал 400 сообщений', 'rare', '👑', 'posts', 'username_color', 'rainbow'),
('posts_500', 'Миф', 'Написал 500 сообщений', 'mythic', '🌟', 'posts', 'username_color', 'diamond'),
('posts_600', 'Икона', 'Написал 600 сообщений', 'mythic', '💎', 'posts', 'username_color', 'platinum'),
('posts_700', 'Божество', 'Написал 700 сообщений', 'mythic', '✨', 'posts', 'username_color', 'emerald'),
('posts_800', 'Властелин', 'Написал 800 сообщений', 'mythic', '🔮', 'posts', 'username_color', 'ruby'),
('posts_900', 'Титан', 'Написал 900 сообщений', 'mythic', '⚡', 'posts', 'username_color', 'sapphire'),
('posts_1000', 'Бог форума', 'Написал 1000 сообщений', 'legendary', '🌈', 'posts', 'username_color', 'legendary')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  achievement_type = EXCLUDED.achievement_type,
  reward_type = EXCLUDED.reward_type,
  reward_value = EXCLUDED.reward_value;

-- Update the award_achievement_with_level function to handle new post levels
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
    -- Upgrade level
    UPDATE user_achievements ua
    SET level = _level, unlocked_at = NOW()
    WHERE ua.user_id = _user_id AND ua.achievement_id = achievement_record.id;
    new_achievement := true;
  END IF;

  -- Create notification for new achievement or level up
  IF new_achievement THEN
    INSERT INTO notifications (user_id, type, title, message)
    VALUES (
      _user_id,
      'achievement',
      'Новое достижение!',
      format('Вы получили достижение "%s"', achievement_record.name)
    );
  END IF;
END;
$$;

-- Update check_post_count_achievements function with new levels
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
  IF post_count >= 1000 THEN
    achievement_level := 17;
  ELSIF post_count >= 900 THEN
    achievement_level := 16;
  ELSIF post_count >= 800 THEN
    achievement_level := 15;
  ELSIF post_count >= 700 THEN
    achievement_level := 14;
  ELSIF post_count >= 600 THEN
    achievement_level := 13;
  ELSIF post_count >= 500 THEN
    achievement_level := 12;
  ELSIF post_count >= 400 THEN
    achievement_level := 11;
  ELSIF post_count >= 350 THEN
    achievement_level := 10;
  ELSIF post_count >= 300 THEN
    achievement_level := 9;
  ELSIF post_count >= 250 THEN
    achievement_level := 8;
  ELSIF post_count >= 200 THEN
    achievement_level := 7;
  ELSIF post_count >= 150 THEN
    achievement_level := 6;
  ELSIF post_count >= 100 THEN
    achievement_level := 5;
  ELSIF post_count >= 75 THEN
    achievement_level := 4;
  ELSIF post_count >= 50 THEN
    achievement_level := 3;
  ELSIF post_count >= 25 THEN
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

-- Update award_achievement function to use new level system
CREATE OR REPLACE FUNCTION public.award_achievement(_user_id uuid, _achievement_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  achievement_type TEXT;
  level_val INTEGER := 1;
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
  level_val := CASE
    WHEN achievement_type = 'posts' THEN
      CASE _achievement_id
        WHEN 'posts_10' THEN 1
        WHEN 'posts_25' THEN 2
        WHEN 'posts_50' THEN 3
        WHEN 'posts_75' THEN 4
        WHEN 'posts_100' THEN 5
        WHEN 'posts_150' THEN 6
        WHEN 'posts_200' THEN 7
        WHEN 'posts_250' THEN 8
        WHEN 'posts_300' THEN 9
        WHEN 'posts_350' THEN 10
        WHEN 'posts_400' THEN 11
        WHEN 'posts_500' THEN 12
        WHEN 'posts_600' THEN 13
        WHEN 'posts_700' THEN 14
        WHEN 'posts_800' THEN 15
        WHEN 'posts_900' THEN 16
        WHEN 'posts_1000' THEN 17
        ELSE 1
      END
    WHEN achievement_type = 'threads' THEN
      CASE _achievement_id
        WHEN 'threads_5' THEN 1
        WHEN 'threads_10' THEN 2
        WHEN 'threads_25' THEN 3
        WHEN 'threads_50' THEN 4
        WHEN 'threads_80' THEN 5
        WHEN 'threads_100' THEN 6
        ELSE 1
      END
    WHEN achievement_type = 'time' THEN
      CASE _achievement_id
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
      END
    ELSE 1
  END;

  -- Use new function
  PERFORM award_achievement_with_level(_user_id, achievement_type, level_val);
END;
$$;

-- Update existing user achievements to use new level system
UPDATE user_achievements ua
SET level = CASE
  WHEN ua.achievement_id = 'posts_10' THEN 1
  WHEN ua.achievement_id = 'posts_25' THEN 2
  WHEN ua.achievement_id = 'posts_50' THEN 3
  WHEN ua.achievement_id = 'posts_75' THEN 4
  WHEN ua.achievement_id = 'posts_100' THEN 5
  WHEN ua.achievement_id = 'posts_150' THEN 6
  WHEN ua.achievement_id = 'posts_200' THEN 7
  WHEN ua.achievement_id = 'posts_250' THEN 8
  WHEN ua.achievement_id = 'posts_300' THEN 9
  WHEN ua.achievement_id = 'posts_350' THEN 10
  WHEN ua.achievement_id = 'posts_400' THEN 11
  WHEN ua.achievement_id = 'posts_500' THEN 12
  WHEN ua.achievement_id = 'posts_600' THEN 13
  WHEN ua.achievement_id = 'posts_700' THEN 14
  WHEN ua.achievement_id = 'posts_800' THEN 15
  WHEN ua.achievement_id = 'posts_900' THEN 16
  WHEN ua.achievement_id = 'posts_1000' THEN 17
  ELSE ua.level
END
WHERE ua.achievement_id LIKE 'posts_%' AND ua.level IS NOT NULL;

-- Note: Existing users will get achievements automatically when they post next time
-- due to the trigger check_post_count_achievements_trigger