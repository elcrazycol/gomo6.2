-- Rich-text profile bio (Lexical JSON) alongside plain bio text
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio_json JSONB;
