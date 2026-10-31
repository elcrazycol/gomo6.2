-- Migration 152: drop the dead standalone gomosubs table.
-- Communities live in boards (is_gomosub = true) since the GomoSub launch;
-- this pre-launch table is created by 001_initial_schema, never written by
-- any code path, and the audit found zero references. IF EXISTS keeps the
-- migration idempotent on installs where it was removed manually.

DROP TABLE IF EXISTS gomosubs;
