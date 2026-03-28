
-- Создаем таблицу для отслеживания ежедневных посещений
CREATE TABLE IF NOT EXISTS public.user_daily_visits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  visit_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, visit_date)
);

ALTER TABLE public.user_daily_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own visits"
  ON public.user_daily_visits
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own visits"
  ON public.user_daily_visits
  FOR SELECT
  USING (auth.uid() = user_id);

-- Функция для проверки достижения "Автоответчик" (3 ответа самому себе подряд)
CREATE OR REPLACE FUNCTION public.check_self_reply_achievement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  last_posts_users uuid[];
BEGIN
  -- Получаем user_id последних 3 постов в треде (включая текущий)
  SELECT ARRAY_AGG(user_id ORDER BY created_at DESC)
  INTO last_posts_users
  FROM (
    SELECT user_id, created_at
    FROM posts
    WHERE thread_id = NEW.thread_id
    ORDER BY created_at DESC
    LIMIT 3
  ) recent;
  
  -- Проверяем, что все 3 поста от одного пользователя
  IF ARRAY_LENGTH(last_posts_users, 1) = 3 
     AND last_posts_users[1] = NEW.user_id 
     AND last_posts_users[2] = NEW.user_id 
     AND last_posts_users[3] = NEW.user_id THEN
    PERFORM award_achievement(NEW.user_id, 'self_reply_3');
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Функция для проверки достижения "Коллекционер" (10 разных картинок)
CREATE OR REPLACE FUNCTION public.check_collector_achievement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  unique_images_count integer;
BEGIN
  IF NEW.image_url IS NOT NULL THEN
    -- Считаем уникальные картинки пользователя
    SELECT COUNT(DISTINCT image_url)
    INTO unique_images_count
    FROM posts
    WHERE user_id = NEW.user_id AND image_url IS NOT NULL;
    
    IF unique_images_count >= 10 THEN
      PERFORM award_achievement(NEW.user_id, 'images_10');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Триггеры для проверки достижений
CREATE TRIGGER check_self_reply_trigger
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION check_self_reply_achievement();

CREATE TRIGGER check_collector_trigger
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION check_collector_achievement();

-- Функция для проверки достижения "Живой" (3 дня подряд)
CREATE OR REPLACE FUNCTION public.check_daily_visit_achievement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  consecutive_days integer;
  check_date date;
BEGIN
  -- Проверяем последние 3 дня подряд
  consecutive_days := 0;
  check_date := CURRENT_DATE;
  
  FOR i IN 0..2 LOOP
    IF EXISTS (
      SELECT 1 FROM user_daily_visits 
      WHERE user_id = NEW.user_id 
      AND visit_date = check_date - i
    ) THEN
      consecutive_days := consecutive_days + 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;
  
  IF consecutive_days >= 3 THEN
    PERFORM award_achievement(NEW.user_id, 'login_3_days');
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE TRIGGER check_daily_visit_trigger
  AFTER INSERT ON public.user_daily_visits
  FOR EACH ROW
  EXECUTE FUNCTION check_daily_visit_achievement();
