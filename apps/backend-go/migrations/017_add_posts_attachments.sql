-- Add attachments column to posts table
ALTER TABLE posts ADD COLUMN IF NOT EXISTS attachments JSONB;
