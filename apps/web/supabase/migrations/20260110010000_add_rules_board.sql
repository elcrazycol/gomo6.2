-- Add rules board
INSERT INTO public.boards (slug, name, description)
VALUES ('rules', 'Правила', 'Правила форума gomo6')
ON CONFLICT (slug) DO NOTHING;