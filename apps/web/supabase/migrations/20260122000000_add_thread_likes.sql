-- Create thread_likes table for storing likes on threads
CREATE TABLE public.thread_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES public.threads(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(thread_id, user_id)
);

-- Create indexes for better performance
CREATE INDEX idx_thread_likes_thread_id ON public.thread_likes(thread_id);
CREATE INDEX idx_thread_likes_user_id ON public.thread_likes(user_id);
CREATE INDEX idx_thread_likes_created_at ON public.thread_likes(created_at DESC);

ALTER TABLE public.thread_likes ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can view likes
CREATE POLICY "Everyone can view thread likes"
  ON public.thread_likes FOR SELECT
  USING (true);

-- Policy: Authenticated users can add/remove their own likes
CREATE POLICY "Users can manage their own thread likes"
  ON public.thread_likes FOR ALL
  USING (auth.uid() = user_id);

-- Function to get likes count for a thread
CREATE OR REPLACE FUNCTION public.get_thread_likes_count(thread_uuid UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM public.thread_likes WHERE thread_id = thread_uuid;
$$;

-- Function to get recent likers for a thread (for tooltip)
CREATE OR REPLACE FUNCTION public.get_recent_thread_likers(thread_uuid UUID, limit_count INTEGER DEFAULT 3)
RETURNS TABLE(username TEXT, id UUID, avatar_url TEXT, is_anonymous BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.username, p.id, p.avatar_url, p.is_anonymous
  FROM public.thread_likes tl
  JOIN public.profiles p ON tl.user_id = p.id
  WHERE tl.thread_id = thread_uuid
  ORDER BY tl.created_at DESC
  LIMIT limit_count;
$$;

-- Function to get user's total thread likes received count
CREATE OR REPLACE FUNCTION public.get_user_thread_likes_received_count(user_uuid UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM public.thread_likes tl
  JOIN public.threads t ON tl.thread_id = t.id
  WHERE t.user_id = user_uuid;
$$;

-- Function to get user's total thread likes given count
CREATE OR REPLACE FUNCTION public.get_user_thread_likes_given_count(user_uuid UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM public.thread_likes WHERE user_id = user_uuid;
$$;

-- Function to check if user liked a thread
CREATE OR REPLACE FUNCTION public.has_user_liked_thread(thread_uuid UUID, user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.thread_likes
    WHERE thread_id = thread_uuid AND user_id = user_uuid
  );
$$;

-- Function to get recommended threads based on user likes
-- Returns threads that users who liked similar threads also liked
CREATE OR REPLACE FUNCTION public.get_recommended_threads(
  user_uuid UUID,
  limit_count INTEGER DEFAULT 20,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE(
  thread_id UUID,
  score FLOAT,
  title TEXT,
  created_at TIMESTAMPTZ,
  post_count INTEGER,
  board_slug TEXT,
  board_name TEXT,
  author_username TEXT,
  author_color TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH user_liked_threads AS (
    SELECT thread_id FROM public.thread_likes WHERE user_id = user_uuid
  ),
  similar_users AS (
    SELECT DISTINCT tl2.user_id
    FROM public.thread_likes tl1
    JOIN public.thread_likes tl2 ON tl1.thread_id = tl2.thread_id
    WHERE tl1.user_id = user_uuid AND tl2.user_id != user_uuid
  ),
  recommended_threads AS (
    SELECT
      tl.thread_id,
      COUNT(*)::FLOAT / GREATEST((SELECT COUNT(*) FROM similar_users), 1) as score,
      t.title,
      t.created_at,
      t.post_count,
      b.slug as board_slug,
      b.name as board_name,
      p.username as author_username,
      -- Get user color from achievements
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.user_achievements ua
          JOIN public.achievements a ON ua.achievement_id = a.id
          WHERE ua.user_id = t.user_id AND a.reward_type = 'username_color'
        ) THEN (
          SELECT a.reward_value FROM public.user_achievements ua
          JOIN public.achievements a ON ua.achievement_id = a.id
          WHERE ua.user_id = t.user_id AND a.reward_type = 'username_color'
          ORDER BY
            CASE a.reward_value
              WHEN 'purple' THEN 1
              WHEN 'gold' THEN 2
              WHEN 'orange' THEN 3
              WHEN 'red' THEN 4
              WHEN 'blue' THEN 5
              WHEN 'green' THEN 6
              WHEN 'yellow' THEN 7
              WHEN 'cyan' THEN 8
              ELSE 9
            END
          LIMIT 1
        )
        ELSE NULL
      END as author_color
    FROM public.thread_likes tl
    JOIN public.threads t ON tl.thread_id = t.id
    JOIN public.boards b ON t.board_id = b.id
    JOIN public.profiles p ON t.user_id = p.id
    WHERE tl.user_id IN (SELECT user_id FROM similar_users)
      AND tl.thread_id NOT IN (SELECT thread_id FROM user_liked_threads)
      AND tl.thread_id != ALL(
        SELECT id FROM public.threads WHERE user_id = user_uuid
      )
    GROUP BY tl.thread_id, t.title, t.created_at, t.post_count, b.slug, b.name, p.username, t.user_id
    ORDER BY score DESC, t.created_at DESC
  )
  SELECT * FROM recommended_threads
  LIMIT limit_count OFFSET offset_count;
$$;