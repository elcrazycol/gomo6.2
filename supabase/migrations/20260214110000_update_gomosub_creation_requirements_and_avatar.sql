-- Update gomosub requirements and add avatar support
ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS gomosub_avatar_url TEXT;

DROP POLICY IF EXISTS "Users with 100+ garma can create gomosubs" ON public.boards;
DROP POLICY IF EXISTS "Users with 50+ garma and 2+ weeks account can create gomosubs" ON public.boards;

CREATE POLICY "Users with 50+ garma and 2+ weeks account can create gomosubs"
  ON public.boards FOR INSERT
  WITH CHECK (
    is_gomosub = true
    AND owner_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND COALESCE(p.garma, 0) >= 50
        AND p.created_at <= NOW() - INTERVAL '14 days'
    )
  );
