-- Profile auto-theme: the owner can enable a theme generated from their
-- background + avatar. theme_tokens is a JSONB map of CSS variables
-- (e.g. {"--primary": "120 60% 35%"}) that viewers apply while viewing
-- the owner's profile page. Values are sanitized server-side (see
-- sanitizeProfileThemeTokens in profile_css.go) so only allow-listed
-- --variable keys with HSL triplets reach the DB.
ALTER TABLE profile_customization
  ADD COLUMN IF NOT EXISTS theme_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS theme_tokens JSONB;
