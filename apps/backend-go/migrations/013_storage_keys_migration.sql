-- Convert stored public URLs to storage keys.
-- Old values were typically:
--   http(s)://<host>/storage/v1/<key>
-- New storage semantics store just "<key>" in DB (so frontend can build URLs via storageUrl()).

BEGIN;

-- users.avatar_url
UPDATE users
SET avatar_url = NULLIF(
  regexp_replace(
    regexp_replace(
      regexp_replace(avatar_url, '^https?://[^/]+/storage/v1/', ''),
      '^/storage/v1/',
      ''
    ),
    '^object/[^/]+/',
    ''
  ),
  ''
)
WHERE avatar_url IS NOT NULL;

-- boards avatars + covers
UPDATE boards
SET
  gomosub_avatar_url = NULLIF(
    regexp_replace(
      regexp_replace(
        regexp_replace(gomosub_avatar_url, '^https?://[^/]+/storage/v1/', ''),
        '^/storage/v1/',
        ''
      ),
      '^object/[^/]+/',
      ''
    ),
    ''
  ),
  cover_image_url = NULLIF(
    regexp_replace(
      regexp_replace(
        regexp_replace(cover_image_url, '^https?://[^/]+/storage/v1/', ''),
        '^/storage/v1/',
        ''
      ),
      '^object/[^/]+/',
      ''
    ),
    ''
  )
WHERE gomosub_avatar_url IS NOT NULL OR cover_image_url IS NOT NULL;

-- gomosubs avatars + covers
UPDATE gomosubs
SET
  avatar_url = NULLIF(
    regexp_replace(
      regexp_replace(
        regexp_replace(avatar_url, '^https?://[^/]+/storage/v1/', ''),
        '^/storage/v1/',
        ''
      ),
      '^object/[^/]+/',
      ''
    ),
    ''
  ),
  cover_image_url = NULLIF(
    regexp_replace(
      regexp_replace(
        regexp_replace(cover_image_url, '^https?://[^/]+/storage/v1/', ''),
        '^/storage/v1/',
        ''
      ),
      '^object/[^/]+/',
      ''
    ),
    ''
  )
WHERE avatar_url IS NOT NULL OR cover_image_url IS NOT NULL;

-- threads
UPDATE threads
SET
  image_url = NULLIF(
    regexp_replace(
      regexp_replace(
        regexp_replace(image_url, '^https?://[^/]+/storage/v1/', ''),
        '^/storage/v1/',
        ''
      ),
      '^object/[^/]+/',
      ''
    ),
    ''
  ),
  image_urls = COALESCE(
    (
      SELECT jsonb_agg(
        NULLIF(
          regexp_replace(
            regexp_replace(
              regexp_replace(elem, '^https?://[^/]+/storage/v1/', ''),
              '^/storage/v1/',
              ''
            ),
            '^object/[^/]+/',
            ''
          ),
          ''
        )
      )
      FROM jsonb_array_elements_text(threads.image_urls) AS t(elem)
    ),
    '[]'::jsonb
  )
WHERE image_url IS NOT NULL OR image_urls IS NOT NULL;

-- posts
UPDATE posts
SET
  image_url = NULLIF(
    regexp_replace(
      regexp_replace(
        regexp_replace(image_url, '^https?://[^/]+/storage/v1/', ''),
        '^/storage/v1/',
        ''
      ),
      '^object/[^/]+/',
      ''
    ),
    ''
  ),
  image_urls = COALESCE(
    (
      SELECT jsonb_agg(
        NULLIF(
          regexp_replace(
            regexp_replace(
              regexp_replace(elem, '^https?://[^/]+/storage/v1/', ''),
              '^/storage/v1/',
              ''
            ),
            '^object/[^/]+/',
            ''
          ),
          ''
        )
      )
      FROM jsonb_array_elements_text(posts.image_urls) AS t(elem)
    ),
    '[]'::jsonb
  )
WHERE image_url IS NOT NULL OR image_urls IS NOT NULL;

COMMIT;

