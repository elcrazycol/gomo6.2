-- i18n: the UI language is stored per-user on the server so it follows the
-- account across devices (unlike theme/font, which are device-local). The
-- column lives on profile_customization, which the generic CRUD layer already
-- partial-upserts keyed by user_id.
ALTER TABLE profile_customization
  ADD COLUMN IF NOT EXISTS language VARCHAR(16) NOT NULL DEFAULT 'ru';

-- Community translations. The canonical list of translatable keys and their
-- Russian source text live in the frontend bundle (src/i18n/locales/ru.ts);
-- this table only stores user-submitted proposals. Multiple proposals for the
-- same (key, locale) coexist and are ranked by net votes — the top-voted one
-- becomes the effective translation served to clients.
CREATE TABLE IF NOT EXISTS translation_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(255) NOT NULL,
  locale VARCHAR(16) NOT NULL,
  value TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  votes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_translation_values_key_locale
  ON translation_values (key, locale, votes DESC);
CREATE INDEX IF NOT EXISTS idx_translation_values_locale
  ON translation_values (locale, votes DESC);

-- One vote per user per proposal (direction is +1 or -1). The net vote count
-- is denormalized onto translation_values.votes for cheap ranked reads.
CREATE TABLE IF NOT EXISTS translation_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  value_id UUID NOT NULL REFERENCES translation_values(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction SMALLINT NOT NULL CHECK (direction IN (-1, 1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (value_id, user_id)
);
