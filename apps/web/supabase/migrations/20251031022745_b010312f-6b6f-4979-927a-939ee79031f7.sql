-- Fix: Create function to check double_post achievement
CREATE OR REPLACE FUNCTION public.check_double_post_achievement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  post_count_in_thread INTEGER;
BEGIN
  -- Count user's posts in this thread
  SELECT COUNT(*) INTO post_count_in_thread 
  FROM posts 
  WHERE thread_id = NEW.thread_id AND user_id = NEW.user_id;
  
  -- Award achievement if user posted twice in same thread
  IF post_count_in_thread >= 2 THEN
    PERFORM award_achievement(NEW.user_id, 'double_post');
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Fix: Create function to check first_reply achievement
CREATE OR REPLACE FUNCTION public.check_first_reply_achievement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  replied_user_id UUID;
BEGIN
  -- Get the user_id of the post being replied to
  IF NEW.reply_to IS NOT NULL THEN
    SELECT user_id INTO replied_user_id
    FROM public.posts
    WHERE id = NEW.reply_to;
    
    -- Award achievement to the person who got the reply
    IF replied_user_id IS NOT NULL AND replied_user_id != NEW.user_id THEN
      PERFORM award_achievement(replied_user_id, 'first_reply');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Fix: Create function to check capslocker achievement
CREATE OR REPLACE FUNCTION public.check_capslocker_achievement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uppercase_count INTEGER;
  total_letters INTEGER;
  thread_posts_count INTEGER;
BEGIN
  -- Count posts in thread by this user
  SELECT COUNT(*) INTO thread_posts_count
  FROM posts
  WHERE thread_id = NEW.thread_id AND user_id = NEW.user_id;
  
  -- Check if user has at least 5 posts in thread
  IF thread_posts_count >= 5 THEN
    -- Count uppercase vs total letters in user's posts in this thread
    SELECT 
      SUM(LENGTH(REGEXP_REPLACE(content, '[^A-ZА-ЯЁ]', '', 'g'))),
      SUM(LENGTH(REGEXP_REPLACE(content, '[^A-Za-zА-Яа-яЁё]', '', 'g')))
    INTO uppercase_count, total_letters
    FROM posts
    WHERE thread_id = NEW.thread_id AND user_id = NEW.user_id;
    
    -- Award if >80% uppercase and at least 50 letters total
    IF total_letters > 50 AND uppercase_count::float / total_letters > 0.8 THEN
      PERFORM award_achievement(NEW.user_id, 'capslocker');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create triggers for new achievement functions
CREATE TRIGGER check_double_post_trigger
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION check_double_post_achievement();

CREATE TRIGGER check_first_reply_trigger
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION check_first_reply_achievement();

CREATE TRIGGER check_capslocker_trigger
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION check_capslocker_achievement();

-- Fix the existing trigger to properly update thread post_count
DROP TRIGGER IF EXISTS update_thread_post_count_trigger ON public.posts;

CREATE TRIGGER update_thread_post_count_trigger
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION update_thread_post_count();