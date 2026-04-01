ALTER TABLE public.profile_wall_posts
ADD COLUMN IF NOT EXISTS repost_of_post_id UUID REFERENCES public.profile_wall_posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_repost_of_post_id
  ON public.profile_wall_posts(repost_of_post_id);

CREATE TABLE IF NOT EXISTS public.profile_wall_post_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.profile_wall_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.profile_wall_post_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.profile_wall_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT,
  content_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.profile_wall_post_reposts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.profile_wall_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  wall_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reposted_wall_post_id UUID REFERENCES public.profile_wall_posts(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(post_id, user_id, wall_user_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_wall_post_likes_post_id
  ON public.profile_wall_post_likes(post_id);

CREATE INDEX IF NOT EXISTS idx_profile_wall_post_comments_post_id
  ON public.profile_wall_post_comments(post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profile_wall_post_reposts_post_id
  ON public.profile_wall_post_reposts(post_id);

CREATE INDEX IF NOT EXISTS idx_profile_wall_post_reposts_wall_user_id
  ON public.profile_wall_post_reposts(wall_user_id);

ALTER TABLE public.profile_wall_post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_wall_post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_wall_post_reposts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view wall post likes" ON public.profile_wall_post_likes;
CREATE POLICY "Users can view wall post likes"
  ON public.profile_wall_post_likes FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profile_wall_posts p
      JOIN public.privacy_settings ps ON ps.user_id = p.user_id
      WHERE p.id = profile_wall_post_likes.post_id
        AND ps.show_profile_wall = true
    )
  );

DROP POLICY IF EXISTS "Users can like visible wall posts" ON public.profile_wall_post_likes;
CREATE POLICY "Users can like visible wall posts"
  ON public.profile_wall_post_likes FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.profile_wall_posts p
      JOIN public.privacy_settings ps ON ps.user_id = p.user_id
      WHERE p.id = profile_wall_post_likes.post_id
        AND ps.show_profile_wall = true
    )
  );

DROP POLICY IF EXISTS "Users can remove own wall likes" ON public.profile_wall_post_likes;
CREATE POLICY "Users can remove own wall likes"
  ON public.profile_wall_post_likes FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view wall comments" ON public.profile_wall_post_comments;
CREATE POLICY "Users can view wall comments"
  ON public.profile_wall_post_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profile_wall_posts p
      JOIN public.privacy_settings ps ON ps.user_id = p.user_id
      WHERE p.id = profile_wall_post_comments.post_id
        AND ps.show_profile_wall = true
    )
  );

DROP POLICY IF EXISTS "Users can create wall comments" ON public.profile_wall_post_comments;
CREATE POLICY "Users can create wall comments"
  ON public.profile_wall_post_comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.profile_wall_posts p
      JOIN public.privacy_settings ps ON ps.user_id = p.user_id
      WHERE p.id = profile_wall_post_comments.post_id
        AND ps.show_profile_wall = true
    )
  );

DROP POLICY IF EXISTS "Users can edit own wall comments" ON public.profile_wall_post_comments;
CREATE POLICY "Users can edit own wall comments"
  ON public.profile_wall_post_comments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete wall comments" ON public.profile_wall_post_comments;
CREATE POLICY "Users can delete wall comments"
  ON public.profile_wall_post_comments FOR DELETE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.profile_wall_posts p
      WHERE p.id = profile_wall_post_comments.post_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view wall reposts" ON public.profile_wall_post_reposts;
CREATE POLICY "Users can view wall reposts"
  ON public.profile_wall_post_reposts FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profile_wall_posts p
      JOIN public.privacy_settings ps ON ps.user_id = p.user_id
      WHERE p.id = profile_wall_post_reposts.post_id
        AND ps.show_profile_wall = true
    )
  );

DROP POLICY IF EXISTS "Users can create wall reposts" ON public.profile_wall_post_reposts;
CREATE POLICY "Users can create wall reposts"
  ON public.profile_wall_post_reposts FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND auth.uid() = wall_user_id
    AND EXISTS (
      SELECT 1
      FROM public.profile_wall_posts p
      JOIN public.privacy_settings ps ON ps.user_id = p.user_id
      WHERE p.id = profile_wall_post_reposts.post_id
        AND ps.show_profile_wall = true
    )
  );

DROP POLICY IF EXISTS "Users can delete own wall reposts" ON public.profile_wall_post_reposts;
CREATE POLICY "Users can delete own wall reposts"
  ON public.profile_wall_post_reposts FOR DELETE
  USING (auth.uid() = user_id AND auth.uid() = wall_user_id);

CREATE OR REPLACE FUNCTION update_profile_wall_comment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_profile_wall_comment_updated_at ON public.profile_wall_post_comments;
CREATE TRIGGER trigger_update_profile_wall_comment_updated_at
  BEFORE UPDATE ON public.profile_wall_post_comments
  FOR EACH ROW EXECUTE FUNCTION update_profile_wall_comment_updated_at();
