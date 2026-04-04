-- Migration: Add attachments column to threads table
-- This enables full attachment support (images, audio, video, files) for thread creation

ALTER TABLE threads ADD COLUMN IF NOT EXISTS attachments JSONB;

-- Add comment for documentation
COMMENT ON COLUMN threads.attachments IS 'JSONB array of attachment metadata including url, type, mime, name, size, and optional poster for videos';
