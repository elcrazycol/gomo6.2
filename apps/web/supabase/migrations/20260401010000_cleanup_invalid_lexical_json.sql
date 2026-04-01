UPDATE public.threads
SET content_json = NULL
WHERE content_json IS NOT NULL
  AND (
    jsonb_typeof(content_json) <> 'object'
    OR jsonb_typeof(content_json->'root') <> 'object'
    OR COALESCE(content_json->'root'->>'type', '') <> 'root'
    OR jsonb_typeof(content_json->'root'->'children') <> 'array'
    OR jsonb_array_length(content_json->'root'->'children') = 0
  );

UPDATE public.posts
SET content_json = NULL
WHERE content_json IS NOT NULL
  AND (
    jsonb_typeof(content_json) <> 'object'
    OR jsonb_typeof(content_json->'root') <> 'object'
    OR COALESCE(content_json->'root'->>'type', '') <> 'root'
    OR jsonb_typeof(content_json->'root'->'children') <> 'array'
    OR jsonb_array_length(content_json->'root'->'children') = 0
  );

UPDATE public.profile_wall_posts
SET content_json = NULL
WHERE content_json IS NOT NULL
  AND (
    jsonb_typeof(content_json) <> 'object'
    OR jsonb_typeof(content_json->'root') <> 'object'
    OR COALESCE(content_json->'root'->>'type', '') <> 'root'
    OR jsonb_typeof(content_json->'root'->'children') <> 'array'
    OR jsonb_array_length(content_json->'root'->'children') = 0
  );

UPDATE public.profiles
SET bio_json = NULL
WHERE bio_json IS NOT NULL
  AND (
    jsonb_typeof(bio_json) <> 'object'
    OR jsonb_typeof(bio_json->'root') <> 'object'
    OR COALESCE(bio_json->'root'->>'type', '') <> 'root'
    OR jsonb_typeof(bio_json->'root'->'children') <> 'array'
    OR jsonb_array_length(bio_json->'root'->'children') = 0
  );
