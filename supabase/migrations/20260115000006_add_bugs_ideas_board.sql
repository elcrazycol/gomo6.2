-- Create bugs/ideas board where only admins can create threads but everyone can post
INSERT INTO public.boards (slug, name, description, is_rules_board) VALUES
  ('bugs', 'Баги/Идеи', 'Отчеты о багах и предложения по улучшению', false)
ON CONFLICT (slug) DO NOTHING;

-- RLS for bugs board threads - only admins can create threads
CREATE POLICY "Only admins can create threads on bugs board" ON public.threads
FOR INSERT WITH CHECK (
  CASE
    WHEN (SELECT slug FROM public.boards WHERE id = board_id) = 'bugs'
    THEN public.has_role(auth.uid(), 'admin'::app_role)
    ELSE auth.uid() = user_id
  END
);

-- RLS for bugs board posts - everyone can post (no restrictions beyond normal auth)
-- This uses the default policy for posts, no special restrictions needed