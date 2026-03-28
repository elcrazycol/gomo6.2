-- Add missing columns to profile_wall_posts table
-- This migration should run after the table is created

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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_is_pinned ON public.profile_wall_posts(is_pinned);
CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_pinned_order ON public.profile_wall_posts(pinned_order);