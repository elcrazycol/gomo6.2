-- Создаём триггер для уведомлений о пингах
CREATE OR REPLACE FUNCTION public.notify_on_mention()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  mentioned_username TEXT;
  mentioned_user_id UUID;
  thread_title TEXT;
  matches TEXT[];
BEGIN
  -- Ищем все упоминания вида @username в контенте
  matches := regexp_matches(NEW.content, '@(\w+)', 'g');
  
  IF matches IS NOT NULL THEN
    FOREACH mentioned_username IN ARRAY matches
    LOOP
      -- Убираем @ из имени
      mentioned_username := TRIM(LEADING '@' FROM mentioned_username);
      
      -- Ищем пользователя с таким username
      SELECT id INTO mentioned_user_id
      FROM public.profiles
      WHERE username = mentioned_username;
      
      -- Если пользователь найден и это не автор поста
      IF mentioned_user_id IS NOT NULL AND mentioned_user_id != NEW.user_id THEN
        -- Получаем название треда
        SELECT title INTO thread_title
        FROM public.threads
        WHERE id = NEW.thread_id;
        
        -- Создаём уведомление
        INSERT INTO public.notifications (user_id, type, title, message, related_post_id, related_thread_id)
        VALUES (
          mentioned_user_id,
          'mention',
          'Вас упомянули в треде',
          'Вас упомянули в треде "' || thread_title || '"',
          NEW.id,
          NEW.thread_id
        );
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Удаляем триггер если он существует
DROP TRIGGER IF EXISTS notify_mention_trigger ON public.posts;

-- Создаём триггер для отслеживания упоминаний
CREATE TRIGGER notify_mention_trigger
AFTER INSERT ON public.posts
FOR EACH ROW
EXECUTE FUNCTION public.notify_on_mention();