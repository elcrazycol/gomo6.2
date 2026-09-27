-- Give «Общение» the plain "#" (hash) icon instead of the chat bubble, so it
-- reads as a neutral catch-all section.
--
-- The 114 seed is updated as well; this file exists for databases that already
-- applied 114 and therefore never re-run it. Idempotent — safe on any state.
UPDATE thread_sections SET icon = 'hash' WHERE slug = 'general';
