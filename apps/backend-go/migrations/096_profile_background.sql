-- Profile background image (avatar + background): a storage key pointing at
-- the user's uploaded banner/background image in the post-images bucket.
-- Stored on profile_customization (not users) so it stays a pure display
-- attribute; reads are exposed to every viewer through the profiles endpoint
-- (LEFT JOIN) and the owner through the generic customization surface.
ALTER TABLE profile_customization ADD COLUMN IF NOT EXISTS background_url TEXT;
