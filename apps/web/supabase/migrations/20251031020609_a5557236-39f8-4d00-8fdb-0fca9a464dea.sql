-- Create table for thread subscriptions
CREATE TABLE IF NOT EXISTS public.thread_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  thread_id UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, thread_id)
);

-- Enable RLS on thread_subscriptions
ALTER TABLE public.thread_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can view their own subscriptions
CREATE POLICY "Users can view their own subscriptions"
ON public.thread_subscriptions
FOR SELECT
USING (auth.uid() = user_id);

-- Users can create their own subscriptions
CREATE POLICY "Users can create their own subscriptions"
ON public.thread_subscriptions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can delete their own subscriptions
CREATE POLICY "Users can delete their own subscriptions"
ON public.thread_subscriptions
FOR DELETE
USING (auth.uid() = user_id);

-- Function to notify subscribed users when a new post is made
CREATE OR REPLACE FUNCTION public.notify_thread_subscribers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  thread_title TEXT;
  subscriber_id UUID;
BEGIN
  -- Get thread title
  SELECT title INTO thread_title
  FROM public.threads
  WHERE id = NEW.thread_id;
  
  -- Notify all subscribers except the post author
  FOR subscriber_id IN 
    SELECT user_id 
    FROM public.thread_subscriptions 
    WHERE thread_id = NEW.thread_id AND user_id != NEW.user_id
  LOOP
    INSERT INTO public.notifications (user_id, type, title, message, related_post_id, related_thread_id)
    VALUES (
      subscriber_id,
      'thread_update',
      'Новое сообщение в отслеживаемом треде',
      'Новое сообщение в треде "' || thread_title || '"',
      NEW.id,
      NEW.thread_id
    );
  END LOOP;
  
  RETURN NEW;
END;
$$;

-- Create trigger for thread subscriptions notifications
CREATE TRIGGER notify_thread_subscribers_trigger
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION notify_thread_subscribers();

-- Function to notify user about achievement
CREATE OR REPLACE FUNCTION public.notify_achievement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  achievement_name TEXT;
  achievement_icon TEXT;
BEGIN
  -- Get achievement details
  SELECT name, icon INTO achievement_name, achievement_icon
  FROM public.achievements
  WHERE id = NEW.achievement_id;
  
  -- Create notification
  INSERT INTO public.notifications (user_id, type, title, message, related_post_id, related_thread_id)
  VALUES (
    NEW.user_id,
    'achievement',
    'Новое достижение!',
    achievement_icon || ' Вы получили достижение "' || achievement_name || '"',
    NULL,
    NULL
  );
  
  RETURN NEW;
END;
$$;

-- Create trigger for achievement notifications
CREATE TRIGGER notify_achievement_trigger
  AFTER INSERT ON public.user_achievements
  FOR EACH ROW
  EXECUTE FUNCTION notify_achievement();