-- Function to check if content is visible to a user based on visibility tags
CREATE OR REPLACE FUNCTION public.is_content_visible_to_user(
  content_text TEXT,
  user_id_to_check UUID,
  post_author_id UUID,
  is_user_admin BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  has_unclosed_seeusers BOOLEAN := FALSE;
  seeusers_match TEXT[];
  nousers_match TEXT[];
  adm_match TEXT;
  unclosed_tag_pos INTEGER;
  closed_tag_pos INTEGER;
BEGIN
  -- Check for unclosed [seeusers=...] tag - if exists, only specified users + author can see
  -- First, find all [seeusers=...] tags
  seeusers_match := regexp_matches(content_text, '\[seeusers=([^\]]+)\]', 'g');
  
  IF seeusers_match IS NOT NULL THEN
    -- Check each tag to see if it's closed
    FOR i IN 1..array_length(seeusers_match, 1) LOOP
      unclosed_tag_pos := position(seeusers_match[i] IN content_text);
      
      -- Check if there's a closing tag after this one
      closed_tag_pos := position('[/seeusers]' IN substring(content_text FROM unclosed_tag_pos));
      
      -- If no closing tag found, this is an unclosed tag
      IF closed_tag_pos IS NULL OR closed_tag_pos = 0 THEN
        has_unclosed_seeusers := TRUE;
        -- User can see if they are the author
        IF user_id_to_check = post_author_id THEN
          RETURN TRUE;
        END IF;
        -- TODO: Parse identifiers from seeusers_match[i] and check if user_id_to_check is in list
        -- For now, if unclosed tag exists and user is not author, return FALSE
        RETURN FALSE;
      END IF;
    END LOOP;
  END IF;

  -- Check for [adm] tags - only admins can see
  IF content_text ~ '\[adm\]' THEN
    -- Check if it's closed tag
    IF content_text ~ '\[adm\].*\[\/adm\]' THEN
      -- Closed tag - check visibility for content between tags
      IF NOT is_user_admin THEN
        -- Check if mention is inside [adm]...[/adm] block
        -- For simplicity, if [adm] tag exists and user is not admin, don't notify
        RETURN FALSE;
      END IF;
    ELSE
      -- Unclosed tag - entire message after tag is admin-only
      IF NOT is_user_admin THEN
        RETURN FALSE;
      END IF;
    END IF;
  END IF;

  -- Check for [nousers=...] tags - exclude specified users
  nousers_match := regexp_matches(content_text, '\[nousers=([^\]]+)\]', 'g');
  IF nousers_match IS NOT NULL THEN
    -- TODO: Parse identifiers and check if user_id_to_check is excluded
    -- For now, if tag exists, we'll need to parse it properly
    -- This is complex and would require parsing usernames/IDs from the tag
  END IF;

  -- Default: content is visible
  RETURN TRUE;
END;
$$;

-- Updated function to create notification on mention with visibility check
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
  is_mentioned_user_admin BOOLEAN;
  content_visible BOOLEAN;
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
        -- Проверяем, является ли упомянутый пользователь админом
        SELECT EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = mentioned_user_id AND role = 'admin'
        ) INTO is_mentioned_user_admin;
        
        -- Проверяем видимость контента для упомянутого пользователя
        content_visible := public.is_content_visible_to_user(
          NEW.content,
          mentioned_user_id,
          NEW.user_id,
          is_mentioned_user_admin
        );
        
        -- Создаём уведомление только если контент виден пользователю
        IF content_visible THEN
          -- Получаем название треда
          SELECT title INTO thread_title
          FROM public.threads
          WHERE id = NEW.thread_id;
          
          -- Проверяем наличие тегов видимости для специального сообщения
          DECLARE
            has_seeusers_tag BOOLEAN := NEW.content ~ '\[seeusers=[^\]]+\]';
            seeusers_users TEXT[];
            visible_users_text TEXT := '';
          BEGIN
            IF has_seeusers_tag THEN
              -- Extract usernames from seeusers tags
              SELECT array_agg(DISTINCT regexp_replace(match[1], '@', '', 'g'))
              INTO seeusers_users
              FROM regexp_matches(NEW.content, '\[seeusers=([^\]]+)\]', 'g') AS match;
              
              IF seeusers_users IS NOT NULL THEN
                visible_users_text := ' для ' || array_to_string(seeusers_users, ', ');
              END IF;
            END IF;
            
            -- Создаём уведомление
            INSERT INTO public.notifications (user_id, type, title, message, related_post_id, related_thread_id)
            VALUES (
              mentioned_user_id,
              'mention',
              CASE 
                WHEN has_seeusers_tag AND visible_users_text != '' THEN 'Вас упомянули в скрытом контенте'
                ELSE 'Вас упомянули в треде'
              END,
              CASE 
                WHEN has_seeusers_tag AND visible_users_text != '' THEN 
                  'Вас упомянули в скрытом контенте' || visible_users_text || ' в треде "' || thread_title || '"'
                ELSE 
                  'Вас упомянули в треде "' || thread_title || '"'
              END,
              NEW.id,
              NEW.thread_id
            );
          END;
        END IF;
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;