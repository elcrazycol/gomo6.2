-- Add attachments column to threads and posts for arbitrary files
ALTER TABLE public.threads
ADD COLUMN IF NOT EXISTS attachments jsonb;

ALTER TABLE public.posts
ADD COLUMN IF NOT EXISTS attachments jsonb;

-- GIN indexes for fast queries
CREATE INDEX IF NOT EXISTS threads_attachments_idx ON public.threads USING GIN (attachments);
CREATE INDEX IF NOT EXISTS posts_attachments_idx ON public.posts USING GIN (attachments);
