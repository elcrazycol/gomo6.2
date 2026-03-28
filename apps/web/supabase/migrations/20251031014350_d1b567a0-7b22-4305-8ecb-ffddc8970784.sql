-- Enable realtime for threads, posts, and notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.threads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Create user bans table
CREATE TABLE IF NOT EXISTS public.user_bans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  banned_by UUID,
  reason TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_permanent BOOLEAN DEFAULT false
);

ALTER TABLE public.user_bans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Moderators can view bans"
ON public.user_bans FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'moderator'::app_role));

CREATE POLICY "Moderators can create bans"
ON public.user_bans FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'moderator'::app_role));

-- Create user warnings table
CREATE TABLE IF NOT EXISTS public.user_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  warned_by UUID,
  reason TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.user_warnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Moderators can view warnings"
ON public.user_warnings FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'moderator'::app_role));

CREATE POLICY "Moderators can create warnings"
ON public.user_warnings FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'moderator'::app_role));

-- Fix achievement triggers
CREATE OR REPLACE FUNCTION public.award_achievement(_user_id uuid, _achievement_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_achievements (user_id, achievement_id)
  VALUES (_user_id, _achievement_id)
  ON CONFLICT (user_id, achievement_id) DO NOTHING;
END;
$$;

-- Trigger for first post achievement
CREATE OR REPLACE FUNCTION public.check_first_post_achievement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Award first post achievement
  PERFORM award_achievement(NEW.user_id, 'first_post');
  
  -- Check for 10 posts
  IF (SELECT COUNT(*) FROM posts WHERE user_id = NEW.user_id) >= 10 THEN
    PERFORM award_achievement(NEW.user_id, 'ten_posts');
  END IF;
  
  -- Check for 100 posts
  IF (SELECT COUNT(*) FROM posts WHERE user_id = NEW.user_id) >= 100 THEN
    PERFORM award_achievement(NEW.user_id, 'hundred_posts');
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_post_created ON posts;
CREATE TRIGGER on_post_created
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION check_first_post_achievement();

-- Trigger for first thread achievement
CREATE OR REPLACE FUNCTION public.check_first_thread_achievement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM award_achievement(NEW.user_id, 'first_thread');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_thread_created ON threads;
CREATE TRIGGER on_thread_created
  AFTER INSERT ON threads
  FOR EACH ROW
  EXECUTE FUNCTION check_first_thread_achievement();

-- Trigger for image upload achievement (deprecated - replaced by newer version)

DROP TRIGGER IF EXISTS on_post_with_image ON posts;
CREATE TRIGGER on_post_with_image
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION check_image_achievement();