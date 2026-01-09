-- Add image_urls column to posts and threads tables for multiple images support
-- This column will store JSON array of image URLs

-- Add image_urls to posts table
ALTER TABLE public.posts 
ADD COLUMN IF NOT EXISTS image_urls JSONB;

-- Add image_urls to threads table  
ALTER TABLE public.threads
ADD COLUMN IF NOT EXISTS image_urls JSONB;

-- Create index for faster queries on image_urls
CREATE INDEX IF NOT EXISTS posts_image_urls_idx ON public.posts USING GIN (image_urls);
CREATE INDEX IF NOT EXISTS threads_image_urls_idx ON public.threads USING GIN (image_urls);
