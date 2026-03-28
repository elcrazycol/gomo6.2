-- Add custom tags support for gomosubs
ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS gomosub_tags JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Keep board data consistent: only string arrays are allowed
ALTER TABLE public.boards
  DROP CONSTRAINT IF EXISTS boards_gomosub_tags_is_string_array;

ALTER TABLE public.boards
  ADD CONSTRAINT boards_gomosub_tags_is_string_array
  CHECK (
    jsonb_typeof(gomosub_tags) = 'array'
    AND NOT jsonb_path_exists(
      gomosub_tags,
      '$[*] ? (@.type() != "string")'
    )
  );
