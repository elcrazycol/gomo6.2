-- Add image_urls column to posts and threads tables for multiple images support
-- This column will store JSON array of image URLs

-- Add image_urls to posts table
ALTER TABLE public.posts
ADD COLUMN IF NOT EXISTS image_urls JSONB;

-- Add image_urls to threads table
ALTER TABLE public.threads
ADD COLUMN IF NOT EXISTS image_urls JSONB;

-- Add avatar_url to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Add account_number to profiles table for sequential account numbering
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS account_number INTEGER;

-- Create index for faster queries on image_urls
CREATE INDEX IF NOT EXISTS posts_image_urls_idx ON public.posts USING GIN (image_urls);
CREATE INDEX IF NOT EXISTS threads_image_urls_idx ON public.threads USING GIN (image_urls);

-- Create index for account_number
CREATE INDEX IF NOT EXISTS profiles_account_number_idx ON public.profiles(account_number);

-- Function to auto-assign account numbers
CREATE OR REPLACE FUNCTION assign_account_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_number IS NULL THEN
    NEW.account_number := COALESCE(
      (SELECT MAX(account_number) FROM public.profiles), 0
    ) + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-assign account numbers on insert
CREATE TRIGGER assign_account_number_trigger
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION assign_account_number();
