-- Add missing columns for threads (frontend compatibility)
-- These were in migration 016 and frontend expects them

ALTER TABLE threads ADD COLUMN IF NOT EXISTS content_json JSONB;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]';
ALTER TABLE threads ADD COLUMN IF NOT EXISTS ephemeral_type VARCHAR(50);
ALTER TABLE threads ADD COLUMN IF NOT EXISTS ephemeral_value VARCHAR(255);
ALTER TABLE threads ADD COLUMN IF NOT EXISTS auto_delete_at TIMESTAMP WITH TIME ZONE;

-- Posts content_json (from migration 016)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_json JSONB;
