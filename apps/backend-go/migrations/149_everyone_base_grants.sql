-- Migration 149: @everyone base grants.
-- The base role ships with view + send allowed (Discord parity: a fresh
-- server is readable and writable by everyone). Only keys that are absent
-- are filled — an explicit deny an admin set is never overwritten.

UPDATE gomosub_roles
SET permissions = COALESCE(permissions, '{}'::jsonb) || '{"view_channel": true}'
WHERE is_everyone = TRUE AND NOT (COALESCE(permissions, '{}'::jsonb) ? 'view_channel');

UPDATE gomosub_roles
SET permissions = COALESCE(permissions, '{}'::jsonb) || '{"send_messages": true}'
WHERE is_everyone = TRUE AND NOT (COALESCE(permissions, '{}'::jsonb) ? 'send_messages');
