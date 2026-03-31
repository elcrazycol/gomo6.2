ALTER TABLE public.threads
ADD COLUMN IF NOT EXISTS content_json JSONB;

ALTER TABLE public.posts
ADD COLUMN IF NOT EXISTS content_json JSONB;

ALTER TABLE public.profile_wall_posts
ADD COLUMN IF NOT EXISTS content_json JSONB;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS bio_json JSONB;
