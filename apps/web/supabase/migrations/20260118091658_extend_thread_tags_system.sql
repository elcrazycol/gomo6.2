-- Extend thread tags system with categories and new tags

-- Add tags field to threads table (JSONB for structured tag storage)
ALTER TABLE public.threads
ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{}'::jsonb;

-- Create index for tags for better performance
CREATE INDEX IF NOT EXISTS threads_tags_idx ON public.threads USING GIN (tags);

-- Update existing threads to migrate old tag field to new tags structure
-- Move old 'tag' field to new 'tags' structure under 'content' category
UPDATE public.threads
SET tags = jsonb_build_object('content', tag)
WHERE tag IS NOT NULL AND tag != '';

-- Remove old tag column (optional - keep for backward compatibility)
-- ALTER TABLE public.threads DROP COLUMN IF EXISTS tag;

-- Create function to validate tags
CREATE OR REPLACE FUNCTION public.validate_thread_tags()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  content_tags text[] := ARRAY['anime', 'games', 'music', 'sports', 'movies', 'comics', 'humor', 'literature', 'stories'];
  format_tags text[] := ARRAY['shitpost', 'discussion', 'question', 'confession', 'story', 'guide'];
  atmosphere_tags text[] := ARRAY['serious', 'irony', 'vent', 'doom'];
  flag_tags text[] := ARRAY['ephemeral', 'normal', 'night', 'highlighted'];
  tag_value text;
BEGIN
  -- Validate content tags
  IF NEW.tags ? 'content' THEN
    tag_value := NEW.tags->>'content';
    IF tag_value IS NOT NULL AND NOT (tag_value = ANY(content_tags)) THEN
      RAISE EXCEPTION 'Invalid content tag: %', tag_value;
    END IF;
  END IF;

  -- Validate format tags
  IF NEW.tags ? 'format' THEN
    tag_value := NEW.tags->>'format';
    IF tag_value IS NOT NULL AND NOT (tag_value = ANY(format_tags)) THEN
      RAISE EXCEPTION 'Invalid format tag: %', tag_value;
    END IF;
  END IF;

  -- Validate atmosphere tags
  IF NEW.tags ? 'atmosphere' THEN
    tag_value := NEW.tags->>'atmosphere';
    IF tag_value IS NOT NULL AND NOT (tag_value = ANY(atmosphere_tags)) THEN
      RAISE EXCEPTION 'Invalid atmosphere tag: %', tag_value;
    END IF;
  END IF;

  -- Validate flag tags
  IF NEW.tags ? 'flag' THEN
    tag_value := NEW.tags->>'flag';
    IF tag_value IS NOT NULL AND NOT (tag_value = ANY(flag_tags)) THEN
      RAISE EXCEPTION 'Invalid flag tag: %', tag_value;
    END IF;
  END IF;

  -- Ensure ephemeral/normal flag is set (required)
  IF NOT (NEW.tags ? 'flag') OR (NEW.tags->>'flag' NOT IN ('ephemeral', 'normal', 'night', 'highlighted')) THEN
    -- Default to 'normal' if not set
    NEW.tags := jsonb_set(NEW.tags, '{flag}', '"normal"');
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger for tag validation
DROP TRIGGER IF EXISTS validate_thread_tags_trigger ON public.threads;
CREATE TRIGGER validate_thread_tags_trigger
  BEFORE INSERT OR UPDATE ON public.threads
  FOR EACH ROW
  EXECUTE FUNCTION validate_thread_tags();

-- Create function to get threads by tags
CREATE OR REPLACE FUNCTION public.get_threads_by_tags(
  board_slug text,
  content_tag text DEFAULT NULL,
  format_tag text DEFAULT NULL,
  atmosphere_tag text DEFAULT NULL,
  flag_tag text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  title text,
  content text,
  image_url text,
  image_urls jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  user_id uuid,
  board_id uuid,
  tags jsonb,
  post_count integer,
  profiles jsonb
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    t.id,
    t.title,
    t.content,
    t.image_url,
    t.image_urls,
    t.created_at,
    t.updated_at,
    t.user_id,
    t.board_id,
    t.tags,
    t.post_count,
    jsonb_build_object(
      'username', p.username,
      'is_anonymous', p.is_anonymous,
      'avatar_url', p.avatar_url
    ) as profiles
  FROM public.threads t
  JOIN public.boards b ON t.board_id = b.id
  LEFT JOIN public.profiles p ON t.user_id = p.id
  WHERE b.slug = board_slug
    AND (content_tag IS NULL OR t.tags->>'content' = content_tag)
    AND (format_tag IS NULL OR t.tags->>'format' = format_tag)
    AND (atmosphere_tag IS NULL OR t.tags->>'atmosphere' = atmosphere_tag)
    AND (flag_tag IS NULL OR t.tags->>'flag' = flag_tag)
  ORDER BY t.updated_at DESC;
$$;