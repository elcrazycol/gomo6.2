-- 125_user_sanctions.sql
--
-- Real sanctions. The `user_bans` registry entry was a dead stub: no table was
-- ever created and nothing checked it, so bans did not work at all. This
-- replaces it with an append-only sanction log:
--
--   warn — a recorded warning (notification only, never blocks);
--   mute — the user may read but not create content;
--   ban  — mute + login is refused.
--
-- Revoking stamps revoked_at/revoked_by instead of deleting, so the history of
-- "кто, когда и почему" survives. Enforcement lives in the sanction gate
-- middleware (mute/ban block non-GET requests) and the login handler (ban).
--
-- user_mod_notes are internal moderator notes about a user — never shown to the
-- user and never exported anywhere.

CREATE TABLE IF NOT EXISTS user_sanctions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('warn', 'mute', 'ban')),
    reason      TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
    reason_code TEXT,
    issued_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    revoked_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sanctions_user
    ON user_sanctions (user_id, created_at DESC);

-- Enforcement hot path: the active mute/ban of one user.
CREATE INDEX IF NOT EXISTS idx_user_sanctions_active
    ON user_sanctions (user_id, kind)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS user_mod_notes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_mod_notes_user
    ON user_mod_notes (user_id, created_at DESC);
