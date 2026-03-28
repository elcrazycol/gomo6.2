-- Restructure boards: move specific boards to /b/ with tags and remove unused boards

-- Add tag column to threads table
ALTER TABLE public.threads
ADD COLUMN IF NOT EXISTS tag TEXT;

-- Create index for tag column for better performance
CREATE INDEX IF NOT EXISTS threads_tag_idx ON public.threads(tag);

-- Move threads from specific boards to /b/ and assign tags
-- /a/ (Anime) -> tag=anime
UPDATE public.threads
SET board_id = (SELECT id FROM public.boards WHERE slug = 'b'),
    tag = 'anime'
WHERE board_id = (SELECT id FROM public.boards WHERE slug = 'a');

-- /v/ (Video games) -> tag=games
UPDATE public.threads
SET board_id = (SELECT id FROM public.boards WHERE slug = 'b'),
    tag = 'games'
WHERE board_id = (SELECT id FROM public.boards WHERE slug = 'v');

-- /mu/ (Music) -> tag=music
UPDATE public.threads
SET board_id = (SELECT id FROM public.boards WHERE slug = 'b'),
    tag = 'music'
WHERE board_id = (SELECT id FROM public.boards WHERE slug = 'mu');

-- /fit/ (Fitness) -> tag=sports
UPDATE public.threads
SET board_id = (SELECT id FROM public.boards WHERE slug = 'b'),
    tag = 'sports'
WHERE board_id = (SELECT id FROM public.boards WHERE slug = 'fit');

-- /tv/ (Movies/TV) -> tag=movies
UPDATE public.threads
SET board_id = (SELECT id FROM public.boards WHERE slug = 'b'),
    tag = 'movies'
WHERE board_id = (SELECT id FROM public.boards WHERE slug = 'tv');

-- /co/ (Comics) -> tag=comics
UPDATE public.threads
SET board_id = (SELECT id FROM public.boards WHERE slug = 'b'),
    tag = 'comics'
WHERE board_id = (SELECT id FROM public.boards WHERE slug = 'co');

-- Delete unused boards
DELETE FROM public.boards WHERE slug IN ('a', 'v', 'mu', 'fit', 'tv', 'co');

-- Update /b/ board description
UPDATE public.boards
SET description = 'Доска для всего подряд'
WHERE slug = 'b';

-- Update other board descriptions to match the new format
UPDATE public.boards
SET name = 'Random / Всё подряд',
    description = 'Доска для всего подряд'
WHERE slug = 'b';

UPDATE public.boards
SET name = 'Политика',
    description = 'Политические дискуссии'
WHERE slug = 'pol';

UPDATE public.boards
SET name = 'Для взрослых',
    description = 'NSFW контент'
WHERE slug = 'd';

UPDATE public.boards
SET name = 'International',
    description = 'Международная доска'
WHERE slug = 'int';