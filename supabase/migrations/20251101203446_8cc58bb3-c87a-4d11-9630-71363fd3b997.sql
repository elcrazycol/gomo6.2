-- Add new achievements
INSERT INTO public.achievements (id, name, description, category, icon) VALUES
('thread_50_posts', '50 постов в треде', 'Создал тред, набравший 50 постов', 'social', '💬'),
('time_10min', 'Дуралей I', 'Провёл на сайте 10 минут', 'time', '⏰'),
('time_30min', 'Дуралей II', 'Провёл на сайте 30 минут', 'time', '⏱️'),
('time_1hour', 'Дуралей III', 'Провёл на сайте 1 час', 'time', '⌛'),
('time_5hours', 'Дуралей IV', 'Провёл на сайте 5 часов', 'time', '🕐'),
('incel', 'Инцел', 'Зашёл в доску /d/ - Для взрослых', 'boards', '🔞')
ON CONFLICT (id) DO NOTHING;

-- Create table to track user terms acceptance
CREATE TABLE IF NOT EXISTS public.user_terms_acceptance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ip_address TEXT,
  UNIQUE(user_id)
);

ALTER TABLE public.user_terms_acceptance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own terms acceptance"
ON public.user_terms_acceptance FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own terms acceptance"
ON public.user_terms_acceptance FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Create table to track user session time
CREATE TABLE IF NOT EXISTS public.user_session_time (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_minutes INTEGER DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE public.user_session_time ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own session time"
ON public.user_session_time FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own session time"
ON public.user_session_time FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own session time"
ON public.user_session_time FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Create table to track board visits for achievements
CREATE TABLE IF NOT EXISTS public.board_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  board_slug TEXT NOT NULL,
  visited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, board_slug)
);

ALTER TABLE public.board_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own board visits"
ON public.board_visits FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own board visits"
ON public.board_visits FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Function to check and award thread achievement when post count reaches milestones
CREATE OR REPLACE FUNCTION public.check_thread_milestone_achievement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  thread_creator_id UUID;
BEGIN
  -- Get thread creator
  SELECT user_id INTO thread_creator_id
  FROM threads
  WHERE id = NEW.id;
  
  -- Award achievement for 50 posts
  IF NEW.post_count >= 50 THEN
    PERFORM award_achievement(thread_creator_id, 'thread_50_posts');
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for thread milestone achievements
DROP TRIGGER IF EXISTS thread_milestone_achievement_trigger ON threads;
CREATE TRIGGER thread_milestone_achievement_trigger
AFTER UPDATE OF post_count ON threads
FOR EACH ROW
EXECUTE FUNCTION check_thread_milestone_achievement();