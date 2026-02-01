-- Final fix for wall posts functionality
-- Only add missing parts that haven't been applied yet

-- Add show_threads_tab column to privacy_settings if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'privacy_settings'
        AND column_name = 'show_threads_tab'
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.privacy_settings
        ADD COLUMN show_threads_tab BOOLEAN DEFAULT true;
    END IF;
END $$;

-- Update existing privacy_settings records to include show_threads_tab
UPDATE public.privacy_settings
SET show_threads_tab = true
WHERE show_threads_tab IS NULL;

-- Add missing columns to profile_wall_posts if they don't exist
DO $$
BEGIN
    -- Add is_pinned column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'profile_wall_posts'
        AND column_name = 'is_pinned'
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.profile_wall_posts
        ADD COLUMN is_pinned BOOLEAN DEFAULT false;
    END IF;

    -- Add pinned_order column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'profile_wall_posts'
        AND column_name = 'pinned_order'
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.profile_wall_posts
        ADD COLUMN pinned_order INTEGER;
    END IF;
END $$;

-- Create indexes (they will be created only if they don't exist)
CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_is_pinned ON public.profile_wall_posts(is_pinned);
CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_pinned_order ON public.profile_wall_posts(pinned_order);

-- Create or replace the toggle_wall_post_pin function
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

-- Ensure RLS policies exist (create only if they don't exist)
DO $$
BEGIN
    -- Check if policy exists before creating
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'profile_wall_posts'
        AND policyname = 'Users can update posts on their wall'
    ) THEN
        CREATE POLICY "Users can update posts on their wall"
          ON public.profile_wall_posts FOR UPDATE
          USING (auth.uid() = user_id)
          WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;