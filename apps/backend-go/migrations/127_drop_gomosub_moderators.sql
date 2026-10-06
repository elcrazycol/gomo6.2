-- 127_drop_gomosub_moderators.sql
--
-- Gomosub moderators were descoped: sub-level moderation is not needed. Migration
-- 126 created the table as a placeholder; nothing ever wrote to it, so it is
-- dropped here rather than left as dead schema.
--
-- 126 is deliberately left untouched (editing an applied migration only triggers
-- a checksum warning and re-runs nothing).

DROP TABLE IF EXISTS gomosub_moderators;
