-- Create post_likes table for storing likes on posts
CREATE TABLE public.post_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(post_id, user_id)
);

-- Create indexes for better performance
CREATE INDEX idx_post_likes_post_id ON public.post_likes(post_id);
CREATE INDEX idx_post_likes_user_id ON public.post_likes(user_id);
CREATE INDEX idx_post_likes_created_at ON public.post_likes(created_at DESC);

ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can view likes
CREATE POLICY "Everyone can view post likes"
  ON public.post_likes FOR SELECT
  USING (true);

-- Policy: Authenticated users can add/remove their own likes
CREATE POLICY "Users can manage their own likes"
  ON public.post_likes FOR ALL
  USING (auth.uid() = user_id);

-- Function to get likes count for a post
CREATE OR REPLACE FUNCTION public.get_post_likes_count(post_uuid UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM public.post_likes WHERE post_id = post_uuid;
$$;

-- Function to get recent likers for a post (for tooltip)
CREATE OR REPLACE FUNCTION public.get_recent_post_likers(post_uuid UUID, limit_count INTEGER DEFAULT 3)
RETURNS TABLE(username TEXT, id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.username, p.id
  FROM public.post_likes pl
  JOIN public.profiles p ON pl.user_id = p.id
  WHERE pl.post_id = post_uuid
  ORDER BY pl.created_at DESC
  LIMIT limit_count;
$$;

-- Function to check if user liked a post
CREATE OR REPLACE FUNCTION public.has_user_liked_post(post_uuid UUID, user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.post_likes
    WHERE post_id = post_uuid AND user_id = user_uuid
  );
$$;