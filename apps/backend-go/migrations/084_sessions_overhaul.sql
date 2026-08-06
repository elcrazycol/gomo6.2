-- 084_sessions_overhaul.sql
-- Stable session identity + country + per-session access-token tracking.
--
-- Previously user_sessions.id was the SHA-256 of the current refresh token, so
-- every token rotation (≈ hourly) deleted the row and created a "new device".
-- The list accumulated fake sessions and the "current device" flag relied on a
-- flaky Redis SCAN. Now:
--   id           — opaque, stable session id (32 hex chars), survives rotation
--   refresh_hash — SHA-256 of the CURRENT refresh token (rotates in place)
--   access_jti   — jti of the currently issued access token (blacklisted on
--                  revoke so the session dies instantly, REST included)
--   country_code / country_name — IP geolocation captured at login

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS refresh_hash VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS access_jti VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) NOT NULL DEFAULT '';
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS country_name VARCHAR(64) NOT NULL DEFAULT '';

-- Backfill: existing rows were already keyed by the refresh-token hash.
UPDATE user_sessions SET refresh_hash = id WHERE refresh_hash = '';

-- Re-issue stable opaque ids for legacy rows (old ids are 64-char sha256 hex).
UPDATE user_sessions
SET id = replace(gen_random_uuid()::text, '-', '')
WHERE id ~ '^[0-9a-f]{64}$';

CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_hash ON user_sessions(refresh_hash);
