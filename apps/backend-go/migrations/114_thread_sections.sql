-- 114_thread_sections.sql
--
-- Global "раздел / подраздел" taxonomy for topics (threads).
--
-- Historically every thread had to live inside a forum board (threads.board_id
-- NOT NULL). The old forum boards were removed in favour of a single global
-- topic type: a topic now belongs to a top-level раздел (thread_sections) and,
-- optionally, to one of its подразделы (thread_subsections). Subsection
-- selection is OPTIONAL — a section with subsections can still host topics
-- directly.
--
-- Board-bound threads (the ones inside g-subs / g-сабов, `is_gomosub = true`)
-- keep working exactly as before: their board_id stays set and section_id is
-- NULL. board_id therefore becomes nullable.
--
-- Two levels only (section → subsection). `is_nsfw` marks adult sections so
-- the UI can gate/warn; it is not an access-control boundary on its own.

CREATE TABLE IF NOT EXISTS thread_sections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        VARCHAR(64)  NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL,
    description TEXT,
    icon        VARCHAR(16),
    is_nsfw     BOOLEAN      NOT NULL DEFAULT FALSE,
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS thread_subsections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id  UUID         NOT NULL REFERENCES thread_sections(id) ON DELETE CASCADE,
    slug        VARCHAR(64)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    description TEXT,
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (section_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_thread_subsections_section_id
    ON thread_subsections(section_id, sort_order);

-- Topic placement. ON DELETE SET NULL keeps the topic alive if a section is
-- ever removed (it degrades to "ungrouped" rather than disappearing).
ALTER TABLE threads
    ADD COLUMN IF NOT EXISTS section_id    UUID REFERENCES thread_sections(id)    ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS subsection_id UUID REFERENCES thread_subsections(id) ON DELETE SET NULL;

-- Global topics have no board.
ALTER TABLE threads ALTER COLUMN board_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_threads_section_id    ON threads(section_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_subsection_id ON threads(subsection_id, updated_at DESC);

-- ── Seed: разделы ───────────────────────────────────────────────────────────
-- `icon` is a frontend icon key (lucide name), not an emoji — the UI renders
-- the matching vector icon. The upsert keeps the catalog in sync when this
-- migration is re-applied (icons/names can be corrected without a new file).
INSERT INTO thread_sections (slug, name, description, icon, is_nsfw, sort_order) VALUES
    ('general',  'Общение',          'Свободное общение, знакомства, встречи',        'messages-square', FALSE, 10),
    ('humor',    'Юмор и мемы',      'Мемы, смешное, абсурд',                          'laugh',           FALSE, 20),
    ('games',    'Игры',             'Компьютерные, консольные, мобильные, настолки',  'gamepad-2',       FALSE, 30),
    ('tech',     'Технологии и IT',  'Программирование, ИИ, железо, гайды',            'cpu',             FALSE, 40),
    ('creative', 'Творчество и арт', 'Рисование, фото, музыка, литература, дизайн',    'palette',         FALSE, 50),
    ('news',     'Новости и общество','Новости, политика, обсуждения',                 'newspaper',       FALSE, 60),
    ('help',     'Помощь и вопросы', 'Вопросы, советы, баги и фичи',                   'life-buoy',       FALSE, 70),
    ('nsfw',     '18+',              'Взрослый контент',                               'flame',           TRUE,  80)
ON CONFLICT (slug) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    icon        = EXCLUDED.icon,
    is_nsfw     = EXCLUDED.is_nsfw,
    sort_order  = EXCLUDED.sort_order;

-- ── Seed: подразделы ────────────────────────────────────────────────────────
INSERT INTO thread_subsections (section_id, slug, name, description, sort_order)
SELECT s.id, v.slug, v.name, v.description, v.sort_order
FROM (
    VALUES
        ('general',  'flood',       'Оффтоп',         'Просто поболтать',            10),
        ('general',  'dating',      'Знакомства',     'Поиск друзей и не только',    20),
        ('general',  'meetups',     'Встречи',        'Собраться офлайн',            30),
        ('humor',    'memes',       'Мемы',           'Свежие мемы',                 10),
        ('humor',    'funny',       'Смешное',        'Всё, что рассмешило',         20),
        ('humor',    'absurd',      'Абсурд',         'Сюр и абсурд',                30),
        ('games',    'pc',          'ПК',             'PC-гейминг',                  10),
        ('games',    'consoles',    'Консоли',        'PlayStation, Xbox, Nintendo', 20),
        ('games',    'mobile',      'Мобильные',      'Игры на телефоне',            30),
        ('games',    'boardgames',  'Настолки',       'Настольные игры',             40),
        ('games',    'esports',     'Киберспорт',     'Турниры и матчи',             50),
        ('tech',     'programming', 'Программирование','Код, инструменты, архитектура', 10),
        ('tech',     'ai',          'ИИ',             'Нейросети и ML',              20),
        ('tech',     'hardware',    'Железо',         'Комплектующие и девайсы',     30),
        ('tech',     'guides',      'Гайды',          'Инструкции и лайфхаки',       40),
        ('creative', 'art',         'Рисование',      'Иллюстрации и скетчи',        10),
        ('creative', 'photo',       'Фото',           'Фотография',                  20),
        ('creative', 'literature',  'Литература',     'Проза и поэзия',              30),
        ('creative', 'music',       'Музыка',         'Своё творчество и релизы',    40),
        ('creative', 'design',      'Дизайн',         'UI/UX и графика',             50),
        ('news',     'news',        'Новости',        'Что произошло',               10),
        ('news',     'politics',    'Политика',       'Политические обсуждения',     20),
        ('news',     'society',     'Обсуждения',     'Общество и мнения',           30),
        ('help',     'questions',   'Вопросы',        'Задать вопрос',               10),
        ('help',     'advice',      'Советы',         'Помогите решить',             20),
        ('help',     'bugs',        'Баги и фичи',    'Сообщить о проблеме',         30)
) AS v(section_slug, slug, name, description, sort_order)
JOIN thread_sections s ON s.slug = v.section_slug
ON CONFLICT (section_id, slug) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    sort_order  = EXCLUDED.sort_order;

-- ── Feed v3: sections + board-less topics ───────────────────────────────────
--
-- get_user_feed did an INNER JOIN boards, which silently dropped any global
-- topic (board_id IS NULL). Recreate it with a LEFT JOIN and add the section
-- columns so the unified feed can label a topic with its раздел/подраздел
-- instead of "в /board/". Signature is unchanged; CREATE OR REPLACE cannot
-- change RETURNS TABLE, hence DROP + CREATE.

DROP FUNCTION IF EXISTS get_user_feed(UUID, INT, TIMESTAMPTZ, DOUBLE PRECISION, UUID);

CREATE FUNCTION get_user_feed(
  user_uuid UUID DEFAULT NULL,
  limit_count INT DEFAULT 20,
  since_ts TIMESTAMPTZ DEFAULT NULL,
  before_sort DOUBLE PRECISION DEFAULT NULL,
  before_id UUID DEFAULT NULL
)
RETURNS TABLE (
  item_type TEXT,
  item_id UUID,
  score DOUBLE PRECISION,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  title TEXT,
  content TEXT,
  content_json JSONB,
  image_url TEXT,
  image_urls JSONB,
  attachments JSONB,
  tags JSONB,
  post_count INTEGER,
  author_id UUID,
  author_username TEXT,
  author_display_name TEXT,
  author_nickname_emoji_id UUID,
  author_is_anonymous BOOLEAN,
  author_avatar_url TEXT,
  board_id UUID,
  board_slug TEXT,
  board_name TEXT,
  board_is_gomosub BOOLEAN,
  section_id UUID,
  section_slug TEXT,
  section_name TEXT,
  section_icon TEXT,
  subsection_id UUID,
  subsection_slug TEXT,
  subsection_name TEXT,
  wall_user_id UUID,
  likes_count BIGINT,
  comments_count BIGINT,
  reposts_count BIGINT,
  liked_by_viewer BOOLEAN,
  views_count BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH
  interest_tags AS (
    SELECT DISTINCT kv.value AS tag
    FROM (
      SELECT t_engaged.tags FROM thread_likes tl_engaged
        JOIN threads t_engaged ON t_engaged.id = tl_engaged.thread_id
        WHERE tl_engaged.user_id = user_uuid
      UNION ALL
      SELECT t_engaged2.tags FROM posts p_engaged
        JOIN threads t_engaged2 ON t_engaged2.id = p_engaged.thread_id
        WHERE p_engaged.user_id = user_uuid
      UNION ALL
      SELECT t_engaged3.tags FROM thread_subscriptions ts_engaged
        JOIN threads t_engaged3 ON t_engaged3.id = ts_engaged.thread_id
        WHERE ts_engaged.user_id = user_uuid
    ) engaged
    CROSS JOIN LATERAL (
      SELECT kv.key, kv.value
      FROM jsonb_each_text(
        CASE WHEN jsonb_typeof(engaged.tags) = 'object' THEN engaged.tags ELSE '{}'::jsonb END
      ) kv
    ) kv
    WHERE kv.value IS NOT NULL AND kv.value <> ''
  ),
  interest_gsub_tags AS (
    SELECT DISTINCT elem.tag AS tag
    FROM gomosub_memberships gm_tags
    JOIN boards b_tags ON b_tags.id = gm_tags.board_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(b_tags.gomosub_tags) = 'array' THEN b_tags.gomosub_tags ELSE '[]'::jsonb END
    ) elem(tag)
    WHERE gm_tags.user_id = user_uuid
  ),
  friend_ids AS (
    SELECT CASE WHEN f.user1_id = user_uuid THEN f.user2_id ELSE f.user1_id END AS fid
    FROM friendships f
    WHERE f.user1_id = user_uuid OR f.user2_id = user_uuid
  ),
  liked_author_ids AS (
    SELECT t_auth.user_id AS aid
    FROM thread_likes tl_auth JOIN threads t_auth ON t_auth.id = tl_auth.thread_id
    WHERE tl_auth.user_id = user_uuid AND t_auth.user_id IS NOT NULL
    UNION
    SELECT p_auth.author_id AS aid
    FROM profile_wall_post_likes wl_auth JOIN profile_wall_posts p_auth ON p_auth.id = wl_auth.post_id
    WHERE wl_auth.user_id = user_uuid AND p_auth.author_id IS NOT NULL
  ),
  member_board_ids AS (
    SELECT gm_board.board_id AS bid
    FROM gomosub_memberships gm_board
    WHERE gm_board.user_id = user_uuid
  ),
  shared_gsub_author_ids AS (
    SELECT DISTINCT gm2.user_id AS aid
    FROM gomosub_memberships gm1
    JOIN gomosub_memberships gm2 ON gm2.board_id = gm1.board_id AND gm2.user_id <> user_uuid
    WHERE gm1.user_id = user_uuid
  ),
  items AS (
    -- ── Threads (global topics + g-subs) ────────────────────────────────────
    SELECT
      'thread'::TEXT AS item_type,
      t.id AS item_id,
      t.created_at,
      t.updated_at,
      t.title::TEXT AS title,
      t.content::TEXT AS content,
      t.content_json,
      t.image_url,
      t.image_urls,
      t.attachments,
      t.tags,
      t.post_count,
      t.user_id AS author_id,
      u.username::TEXT AS author_username,
      u.display_name::TEXT AS author_display_name,
      u.nickname_emoji_id AS author_nickname_emoji_id,
      COALESCE(u.is_anonymous, FALSE) AS author_is_anonymous,
      u.avatar_url AS author_avatar_url,
      t.board_id,
      b.slug::TEXT AS board_slug,
      b.name::TEXT AS board_name,
      COALESCE(b.is_gomosub, FALSE) AS board_is_gomosub,
      t.section_id,
      ts.slug::TEXT AS section_slug,
      ts.name::TEXT AS section_name,
      ts.icon::TEXT AS section_icon,
      t.subsection_id,
      tss.slug::TEXT AS subsection_slug,
      tss.name::TEXT AS subsection_name,
      NULL::UUID AS wall_user_id,
      (SELECT COUNT(*)::BIGINT FROM thread_likes tl WHERE tl.thread_id = t.id) AS likes_count,
      t.post_count::BIGINT AS comments_count,
      0::BIGINT AS reposts_count,
      EXISTS(SELECT 1 FROM thread_likes tl WHERE tl.thread_id = t.id AND tl.user_id = user_uuid) AS liked_by_viewer,
      0::BIGINT AS views_count,
      (CASE WHEN t.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM friend_ids f WHERE f.fid = t.user_id) THEN 7200.0 ELSE 0.0 END) AS friend_boost,
      (CASE WHEN t.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM liked_author_ids la WHERE la.aid = t.user_id) THEN 3600.0 ELSE 0.0 END) AS liked_author_boost,
      (CASE WHEN t.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM shared_gsub_author_ids sa WHERE sa.aid = t.user_id) THEN 1800.0 ELSE 0.0 END) AS shared_gsub_boost,
      LEAST(3600.0, 900.0 * (
        SELECT COUNT(*)::DOUBLE PRECISION
        FROM jsonb_each_text(CASE WHEN jsonb_typeof(t.tags) = 'object' THEN t.tags ELSE '{}'::jsonb END) kv_tags
        WHERE kv_tags.value IN (SELECT it.tag FROM interest_tags it)
           OR kv_tags.value IN (SELECT ig.tag FROM interest_gsub_tags ig)
      )) AS tag_boost
    FROM threads t
    LEFT JOIN boards b ON b.id = t.board_id
    LEFT JOIN thread_sections ts ON ts.id = t.section_id
    LEFT JOIN thread_subsections tss ON tss.id = t.subsection_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.channel_id IS NULL
      AND NOT COALESCE(b.is_rules_board, FALSE)
      -- board visibility: no board (global topic) is always visible; otherwise
      -- public, own private board, or member of the gsub.
      AND (t.board_id IS NULL
           OR COALESCE(b.visibility, 'public') <> 'private'
           OR b.owner_id = user_uuid
           OR (user_uuid IS NOT NULL AND EXISTS (SELECT 1 FROM gomosub_memberships gm WHERE gm.board_id = t.board_id AND gm.user_id = user_uuid)))

    UNION ALL

    -- ── Profile wall posts ──────────────────────────────────────────────────
    SELECT
      'wall_post'::TEXT AS item_type,
      p.id AS item_id,
      p.created_at,
      p.updated_at,
      p.title::TEXT AS title,
      p.content::TEXT AS content,
      p.content_json,
      p.image_url,
      NULL::JSONB AS image_urls,
      p.attachments,
      NULL::JSONB AS tags,
      NULL::INTEGER AS post_count,
      p.author_id,
      u.username::TEXT AS author_username,
      u.display_name::TEXT AS author_display_name,
      u.nickname_emoji_id AS author_nickname_emoji_id,
      COALESCE(u.is_anonymous, FALSE) AS author_is_anonymous,
      u.avatar_url AS author_avatar_url,
      NULL::UUID AS board_id,
      NULL::TEXT AS board_slug,
      NULL::TEXT AS board_name,
      FALSE AS board_is_gomosub,
      NULL::UUID AS section_id,
      NULL::TEXT AS section_slug,
      NULL::TEXT AS section_name,
      NULL::TEXT AS section_icon,
      NULL::UUID AS subsection_id,
      NULL::TEXT AS subsection_slug,
      NULL::TEXT AS subsection_name,
      p.user_id AS wall_user_id,
      (SELECT COUNT(*)::BIGINT FROM profile_wall_post_likes l WHERE l.post_id = p.id) AS likes_count,
      (SELECT COUNT(*)::BIGINT FROM profile_wall_post_comments c WHERE c.post_id = p.id) AS comments_count,
      (SELECT COUNT(*)::BIGINT FROM profile_wall_post_reposts r WHERE r.post_id = p.id) AS reposts_count,
      EXISTS(SELECT 1 FROM profile_wall_post_likes l WHERE l.post_id = p.id AND l.user_id = user_uuid) AS liked_by_viewer,
      (SELECT COUNT(*)::BIGINT FROM profile_wall_post_views v WHERE v.post_id = p.id) AS views_count,
      (CASE WHEN (p.author_id IS NOT NULL AND EXISTS(SELECT 1 FROM friend_ids f WHERE f.fid = p.author_id))
              OR (p.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM friend_ids f WHERE f.fid = p.user_id))
            THEN 7200.0 ELSE 0.0 END) AS friend_boost,
      (CASE WHEN p.author_id IS NOT NULL AND EXISTS(SELECT 1 FROM liked_author_ids la WHERE la.aid = p.author_id) THEN 3600.0 ELSE 0.0 END) AS liked_author_boost,
      (CASE WHEN p.author_id IS NOT NULL AND EXISTS(SELECT 1 FROM shared_gsub_author_ids sa WHERE sa.aid = p.author_id) THEN 1800.0 ELSE 0.0 END) AS shared_gsub_boost,
      0.0 AS tag_boost
    FROM profile_wall_posts p
    LEFT JOIN users u ON u.id = p.author_id
    LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
    WHERE (p.user_id = user_uuid
           OR (NOT COALESCE(ps.private_profile, FALSE) AND NOT COALESCE(ps.private_hide_wall, FALSE))
           OR EXISTS (SELECT 1 FROM friendships f
                      WHERE (f.user1_id = p.user_id AND f.user2_id = user_uuid)
                         OR (f.user1_id = user_uuid AND f.user2_id = p.user_id)))
  ),
  boosted AS (
    SELECT it.*,
      LEAST(
        14400.0,
        COALESCE(it.friend_boost, 0.0)
          + COALESCE(it.liked_author_boost, 0.0)
          + COALESCE(it.shared_gsub_boost, 0.0)
          + COALESCE(it.tag_boost, 0.0)
          + LEAST(14400.0, 1200.0 * LN(1.0
              + it.likes_count::DOUBLE PRECISION
              + 2.0 * it.comments_count::DOUBLE PRECISION
              + 3.0 * it.reposts_count::DOUBLE PRECISION
              + it.views_count::DOUBLE PRECISION / 10.0))
      ) AS boost_seconds
    FROM items it
  ),
  ranked AS (
    SELECT b.*,
      EXTRACT(EPOCH FROM b.created_at) + b.boost_seconds AS score,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(b.author_id, b.item_id)
        ORDER BY EXTRACT(EPOCH FROM b.created_at) + b.boost_seconds DESC
      ) AS author_rn
    FROM boosted b
  )
  SELECT
    r.item_type, r.item_id, r.score, r.created_at, r.updated_at,
    r.title, r.content, r.content_json, r.image_url, r.image_urls, r.attachments, r.tags, r.post_count,
    r.author_id, r.author_username, r.author_display_name, r.author_nickname_emoji_id,
    r.author_is_anonymous, r.author_avatar_url, r.board_id, r.board_slug, r.board_name,
    r.board_is_gomosub, r.section_id, r.section_slug, r.section_name, r.section_icon,
    r.subsection_id, r.subsection_slug, r.subsection_name,
    r.wall_user_id, r.likes_count, r.comments_count, r.reposts_count, r.liked_by_viewer,
    r.views_count
  FROM ranked r
  WHERE r.author_rn <= 5
    AND (since_ts IS NULL OR r.created_at > since_ts)
    AND (before_sort IS NULL
         OR r.score < before_sort
         OR (r.score = before_sort AND r.item_id < before_id))
  ORDER BY r.score DESC, r.item_id DESC
  LIMIT limit_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_feed(UUID, INT, TIMESTAMPTZ, DOUBLE PRECISION, UUID) TO gomo6;
