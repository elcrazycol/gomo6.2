ALTER TABLE public.profile_wall_posts
ADD COLUMN IF NOT EXISTS attachments JSONB;

UPDATE public.profile_wall_posts
SET attachments = jsonb_build_array(
  jsonb_build_object(
    'url', image_url,
    'type', 'image',
    'mime', 'image/*',
    'name', 'wall-image',
    'size', 0
  )
)
WHERE image_url IS NOT NULL
  AND (attachments IS NULL OR attachments = 'null'::jsonb);
