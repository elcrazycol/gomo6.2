-- Fix wall posts pinning functionality
-- Add missing columns to existing profile_wall_posts table

-- Add pinning columns if they don't exist
ALTER TABLE public.profile_wall_posts
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS pinned_order INTEGER;

-- Create indexes for pinning functionality
CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_is_pinned ON public.profile_wall_posts(is_pinned);
CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_pinned_order ON public.profile_wall_posts(pinned_order);

-- Create function to pin/unpin wall posts (if it doesn't exist)
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

-- Update RLS policies to allow profile owners to update posts for pinning
DROP POLICY IF EXISTS "Profile owners can pin posts on their wall" ON public.profile_wall_posts;
CREATE POLICY "Profile owners can update posts on their wall"
  ON public.profile_wall_posts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Update existing privacy_settings records to include new fields
UPDATE public.privacy_settings
SET show_threads_tab = true
WHERE show_threads_tab IS NULL;