-- Per-user appearance/theme settings, synced across devices. localStorage on
-- the client stays a cache; this table is the source of truth once a user is
-- logged in. One row per user (upserted by the handler).
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme_id TEXT,
    theme_mode TEXT,
    time_auto BOOLEAN NOT NULL DEFAULT FALSE,
    custom_font TEXT,
    favorite_theme_ids TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
