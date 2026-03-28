-- Add extended achievements system

-- Add custom_message field to threads table
ALTER TABLE public.threads
ADD COLUMN IF NOT EXISTS custom_message TEXT;

-- Add new time-based achievements (Дуралей V-X)
INSERT INTO public.achievements (id, name, description, category, icon, achievement_type) VALUES
('time_10hours', 'Дуралей V', 'Провёл на сайте 10 часов', 'time', '🕒', 'time'),
('time_25hours', 'Дуралей VI', 'Провёл на сайте 25 часов', 'time', '🕔', 'time'),
('time_50hours', 'Дуралей VII', 'Провёл на сайте 50 часов', 'time', '🕖', 'time'),
('time_100hours', 'Дуралей VIII', 'Провёл на сайте 100 часов', 'time', '🕘', 'time'),
('time_250hours', 'Дуралей IX', 'Провёл на сайте 250 часов', 'time', '🕛', 'time'),
('time_500hours', 'Дуралей X', 'Провёл на сайте 500 часов', 'time', '⏳', 'time')
ON CONFLICT (id) DO NOTHING;

-- Add post count achievements
INSERT INTO public.achievements (id, name, description, category, icon, achievement_type) VALUES
('posts_250', 'Болтливый', 'Написал 250 сообщений', 'basic', '💬', 'posts'),
('posts_500', 'Многословный', 'Написал 500 сообщений', 'basic', '📝', 'posts'),
('posts_1000', 'Кладезь мудрости', 'Написал 1000 сообщений', 'basic', '📚', 'posts'),
('posts_2500', 'Мастер слова', 'Написал 2500 сообщений', 'rare', '🎭', 'posts'),
('posts_5000', 'Легенда форума', 'Написал 5000 сообщений', 'rare', '👑', 'posts')
ON CONFLICT (id) DO NOTHING;

-- Add thread creation achievements
INSERT INTO public.achievements (id, name, description, category, icon, achievement_type) VALUES
('threads_5', 'Создатель', 'Создал 5 тредов', 'basic', '🎯', 'threads'),
('threads_10', 'Творец', 'Создал 10 тредов', 'basic', '✨', 'threads'),
('threads_25', 'Генератор идей', 'Создал 25 тредов', 'social', '💡', 'threads'),
('threads_50', 'Архитектор сообщества', 'Создал 50 тредов', 'social', '🏗️', 'threads'),
('threads_80', 'Мастер дискуссий', 'Создал 80 тредов', 'rare', '🗣️', 'threads'),
('threads_100', 'Легенда форума', 'Создал 100 тредов', 'rare', '🌟', 'threads')
ON CONFLICT (id) DO NOTHING;

-- Add settings achievements
INSERT INTO public.achievements (id, name, description, category, icon, achievement_type) VALUES
('font_customizer', 'Персонализатор', 'Изменил шрифт в настройках', 'basic', '🎨', 'settings'),
('rules_reader', 'Юрист', 'Прочитал соглашение сайта', 'basic', '📖', 'activity')
ON CONFLICT (id) DO NOTHING;

-- Add thread interaction achievements
INSERT INTO public.achievements (id, name, description, category, icon, achievement_type) VALUES
('custom_message_thread', 'Специальный гость', 'Зашёл в тред с пользовательским сообщением', 'social', '🎪', 'activity')
ON CONFLICT (id) DO NOTHING;

-- Add tables for tracking user actions
CREATE TABLE IF NOT EXISTS public.user_settings_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setting_name TEXT NOT NULL,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, setting_name)
);

ALTER TABLE public.user_settings_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own settings changes"
ON public.user_settings_changes FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own settings changes"
ON public.user_settings_changes FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Add table for tracking thread visits with custom messages
CREATE TABLE IF NOT EXISTS public.thread_custom_message_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  has_custom_message BOOLEAN DEFAULT false,
  visited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, thread_id)
);

ALTER TABLE public.thread_custom_message_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own thread visits"
ON public.thread_custom_message_visits FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own thread visits"
ON public.thread_custom_message_visits FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Function to check and award post count achievements
CREATE OR REPLACE FUNCTION public.check_post_count_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  post_count INTEGER;
BEGIN
  -- Get user's post count
  SELECT COALESCE(p.post_count, 0) INTO post_count
  FROM profiles p
  WHERE p.id = NEW.user_id;

  -- Post count achievements
  IF post_count >= 250 THEN
    PERFORM award_achievement(NEW.user_id, 'posts_250');
  END IF;
  IF post_count >= 500 THEN
    PERFORM award_achievement(NEW.user_id, 'posts_500');
  END IF;
  IF post_count >= 1000 THEN
    PERFORM award_achievement(NEW.user_id, 'posts_1000');
  END IF;
  IF post_count >= 2500 THEN
    PERFORM award_achievement(NEW.user_id, 'posts_2500');
  END IF;
  IF post_count >= 5000 THEN
    PERFORM award_achievement(NEW.user_id, 'posts_5000');
  END IF;

  RETURN NEW;
END;
$$;

-- Function to check and award thread count achievements
CREATE OR REPLACE FUNCTION public.check_thread_count_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  thread_count INTEGER;
BEGIN
  -- Get user's thread count
  SELECT COALESCE(p.thread_count, 0) INTO thread_count
  FROM profiles p
  WHERE p.id = NEW.user_id;

  -- Thread creation achievements
  IF thread_count >= 5 THEN
    PERFORM award_achievement(NEW.user_id, 'threads_5');
  END IF;
  IF thread_count >= 10 THEN
    PERFORM award_achievement(NEW.user_id, 'threads_10');
  END IF;
  IF thread_count >= 25 THEN
    PERFORM award_achievement(NEW.user_id, 'threads_25');
  END IF;
  IF thread_count >= 50 THEN
    PERFORM award_achievement(NEW.user_id, 'threads_50');
  END IF;
  IF thread_count >= 80 THEN
    PERFORM award_achievement(NEW.user_id, 'threads_80');
  END IF;
  IF thread_count >= 100 THEN
    PERFORM award_achievement(NEW.user_id, 'threads_100');
  END IF;

  RETURN NEW;
END;
$$;

-- Function to award font customization achievement
CREATE OR REPLACE FUNCTION public.award_font_achievement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Award achievement when user changes font setting
  IF NEW.setting_name = 'custom_font' THEN
    PERFORM award_achievement(NEW.user_id, 'font_customizer');
  END IF;

  RETURN NEW;
END;
$$;

-- Function to award rules reading achievement
CREATE OR REPLACE FUNCTION public.award_rules_achievement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  board_is_rules BOOLEAN;
BEGIN
  -- Check if this is a rules board thread
  SELECT b.is_rules_board INTO board_is_rules
  FROM threads t
  JOIN boards b ON t.board_id = b.id
  WHERE t.id = NEW.thread_id;

  IF board_is_rules THEN
    PERFORM award_achievement(NEW.user_id, 'rules_reader');
  END IF;

  RETURN NEW;
END;
$$;

-- Function to award custom message thread visit achievement
CREATE OR REPLACE FUNCTION public.award_custom_message_thread_achievement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  thread_message TEXT;
BEGIN
  -- Check if thread has a custom message
  SELECT custom_message INTO thread_message
  FROM threads
  WHERE id = NEW.thread_id;

  IF thread_message IS NOT NULL AND LENGTH(TRIM(thread_message)) > 0 THEN
    PERFORM award_achievement(NEW.user_id, 'custom_message_thread');
  END IF;

  RETURN NEW;
END;
$$;

-- Create triggers
CREATE TRIGGER check_post_count_achievements_trigger
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION check_post_count_achievements();

CREATE TRIGGER check_thread_count_achievements_trigger
  AFTER INSERT ON threads
  FOR EACH ROW
  EXECUTE FUNCTION check_thread_count_achievements();

CREATE TRIGGER award_font_achievement_trigger
  AFTER INSERT ON user_settings_changes
  FOR EACH ROW
  EXECUTE FUNCTION award_font_achievement();

CREATE TRIGGER award_rules_achievement_trigger
  AFTER INSERT ON thread_custom_message_visits
  FOR EACH ROW
  EXECUTE FUNCTION award_rules_achievement();

CREATE TRIGGER award_custom_message_thread_trigger
  AFTER INSERT ON thread_custom_message_visits
  FOR EACH ROW
  EXECUTE FUNCTION award_custom_message_thread_achievement();