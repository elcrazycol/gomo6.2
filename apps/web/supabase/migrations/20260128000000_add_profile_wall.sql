-- Create profile wall posts table
CREATE TABLE IF NOT EXISTS public.profile_wall_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add pinning columns if they don't exist
ALTER TABLE public.profile_wall_posts
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS pinned_order INTEGER;

-- Add wall privacy settings to privacy_settings table
ALTER TABLE public.privacy_settings
ADD COLUMN IF NOT EXISTS show_profile_wall BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS allow_wall_posts_from_others BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS show_threads_tab BOOLEAN DEFAULT true;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_user_id ON public.profile_wall_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_author_id ON public.profile_wall_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_created_at ON public.profile_wall_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_is_pinned ON public.profile_wall_posts(is_pinned);
CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_pinned_order ON public.profile_wall_posts(pinned_order);

-- Create RLS policies for profile_wall_posts
-- Users can view wall posts if the profile owner allows it
CREATE POLICY "Users can view wall posts when allowed"
  ON public.profile_wall_posts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.privacy_settings ps
      WHERE ps.user_id = profile_wall_posts.user_id
      AND ps.show_profile_wall = true
    )
  );

-- Users can insert wall posts on their own wall or when allowed by the profile owner
CREATE POLICY "Users can create wall posts when allowed"
  ON public.profile_wall_posts FOR INSERT
  WITH CHECK (
    (auth.uid() = user_id) OR
    (
      EXISTS (
        SELECT 1 FROM public.privacy_settings ps
        WHERE ps.user_id = profile_wall_posts.user_id
        AND ps.allow_wall_posts_from_others = true
      )
    )
  );

-- Users can update their own wall posts
CREATE POLICY "Users can update their own wall posts"
  ON public.profile_wall_posts FOR UPDATE
  USING (auth.uid() = author_id);

-- Profile owners can update posts on their wall (for pinning)
CREATE POLICY "Profile owners can update posts on their wall"
  ON public.profile_wall_posts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own wall posts or posts on their own wall
CREATE POLICY "Users can delete wall posts"
  ON public.profile_wall_posts FOR DELETE
  USING (auth.uid() = author_id OR auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_profile_wall_post_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
CREATE TRIGGER trigger_update_profile_wall_post_updated_at
  BEFORE UPDATE ON public.profile_wall_posts
  FOR EACH ROW EXECUTE FUNCTION update_profile_wall_post_updated_at();

-- Create function to pin/unpin wall posts
CREATE OR REPLACE FUNCTION toggle_wall_post_pin(
  _post_id UUID,
  _user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  current_pinned BOOLEAN;
  post_owner_id UUID;
BEGIN
  -- Check if the user is the profile owner
  SELECT user_id INTO post_owner_id FROM profile_wall_posts WHERE id = _post_id;
  IF post_owner_id != _user_id THEN
    RETURN FALSE;
  END IF;

  -- Get current pin status
  SELECT is_pinned INTO current_pinned FROM profile_wall_posts WHERE id = _post_id;

  IF current_pinned THEN
    -- Unpin the post
    UPDATE profile_wall_posts SET is_pinned = false, pinned_order = NULL WHERE id = _post_id;
  ELSE
    -- Pin the post (only one post can be pinned, so unpin others first)
    UPDATE profile_wall_posts SET is_pinned = false, pinned_order = NULL WHERE user_id = _user_id AND is_pinned = true;
    UPDATE profile_wall_posts SET is_pinned = true, pinned_order = 1 WHERE id = _post_id;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update existing privacy_settings records
UPDATE public.privacy_settings
SET show_profile_wall = true, allow_wall_posts_from_others = true, show_threads_tab = true
WHERE show_profile_wall IS NULL OR allow_wall_posts_from_others IS NULL OR show_threads_tab IS NULL;