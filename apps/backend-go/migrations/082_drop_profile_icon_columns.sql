-- K2: remove the user-supplied SVG icon feature (stored XSS vector).
-- The icon is replaced by regular photos (avatars) in a future iteration.
ALTER TABLE profile_customization DROP COLUMN IF EXISTS username_icon_svg;
ALTER TABLE profile_customization DROP COLUMN IF EXISTS username_icon_fill;
ALTER TABLE profile_customization DROP COLUMN IF EXISTS username_icon_stroke;
