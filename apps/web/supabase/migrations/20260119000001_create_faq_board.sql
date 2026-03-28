-- Create FAQ board (admin only)
INSERT INTO public.boards (id, name, slug, description, is_rules_board, created_at)
VALUES (
  gen_random_uuid(),
  'FAQ',
  'faq',
  'Часто задаваемые вопросы',
  false,
  NOW()
)
ON CONFLICT (slug) DO NOTHING;

-- Create RLS policy for FAQ board - only admins can create threads/posts
-- Note: This assumes you already have RLS policies for threads and posts tables
-- You may need to add specific policies for the FAQ board if needed
