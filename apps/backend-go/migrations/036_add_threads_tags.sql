-- Adds tags column to threads (JSONB DEFAULT '[]')
-- This is referenced from threads.go GetThreads handler.
ALTER TABLE threads ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
