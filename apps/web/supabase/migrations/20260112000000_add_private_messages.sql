-- Add private messages functionality to posts table
ALTER TABLE public.posts
ADD COLUMN is_private BOOLEAN DEFAULT false NOT NULL,
ADD COLUMN private_recipient_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add achievement for private messages
INSERT INTO public.achievements (id, name, description, icon, category)
VALUES ('private_message', 'Шёпот в треде', 'Отправить скрытое сообщение пользователю в треде', '👁️‍🗨️', 'social')
ON CONFLICT (id) DO NOTHING;

-- Function to award private message achievement
CREATE OR REPLACE FUNCTION public.award_private_message_achievement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only award if this is a private message
  IF NEW.is_private THEN
    PERFORM award_achievement(NEW.user_id, 'private_message');
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger to award achievement when private message is sent
CREATE TRIGGER award_private_message_trigger
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.award_private_message_achievement();

-- Function to decrease profile stats when post is deleted
CREATE OR REPLACE FUNCTION public.decrease_profile_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'threads' THEN
    UPDATE public.profiles
    SET thread_count = GREATEST(thread_count - 1, 0)
    WHERE id = OLD.user_id;
  ELSIF TG_TABLE_NAME = 'posts' THEN
    UPDATE public.profiles
    SET post_count = GREATEST(post_count - 1, 0)
    WHERE id = OLD.user_id;

    -- Decrease image count if image was uploaded
    IF OLD.image_url IS NOT NULL THEN
      UPDATE public.profiles
      SET image_upload_count = GREATEST(image_upload_count - 1, 0)
      WHERE id = OLD.user_id;
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

-- Trigger to decrease profile stats when post is deleted
CREATE TRIGGER on_post_deleted
  AFTER DELETE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.decrease_profile_stats();