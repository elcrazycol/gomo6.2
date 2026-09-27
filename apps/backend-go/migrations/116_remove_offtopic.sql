-- 116_remove_offtopic.sql
--
-- Drop the «Оффтоп» taxonomy entry entirely. It started as a подраздел of
-- «Общение» and was briefly promoted to its own раздел — neither is wanted:
-- «Общение» is the catch-all. Topics are re-homed to «Общение» and the extra
-- rows are removed. Idempotent — safe on any DB state.

-- 1. If a top-level «Оффтоп» section exists, move its topics to «Общение».
WITH general AS (
    SELECT id FROM thread_sections WHERE slug = 'general'
)
UPDATE threads t
SET section_id    = (SELECT id FROM general),
    subsection_id = NULL
WHERE t.section_id = (SELECT id FROM thread_sections WHERE slug = 'offtopic');

-- 2. Remove the «Оффтоп» section.
DELETE FROM thread_sections WHERE slug = 'offtopic';

-- 3. If the «Оффтоп» подраздел of «Общение» exists, lift its topics up to the
--    section itself and remove the подраздел.
WITH general AS (
    SELECT id FROM thread_sections WHERE slug = 'general'
),
flood AS (
    SELECT ss.id
    FROM thread_subsections ss
    JOIN thread_sections s ON s.id = ss.section_id
    WHERE s.slug = 'general' AND ss.slug = 'flood'
)
UPDATE threads t
SET section_id    = (SELECT id FROM general),
    subsection_id = NULL
WHERE t.subsection_id = (SELECT id FROM flood);

DELETE FROM thread_subsections ss
USING thread_sections s
WHERE s.id = ss.section_id AND s.slug = 'general' AND ss.slug = 'flood';
