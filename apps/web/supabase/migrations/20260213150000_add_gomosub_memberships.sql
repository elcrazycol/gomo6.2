-- Memberships for gomosubs (join/leave)
CREATE TABLE IF NOT EXISTS public.gomosub_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, board_id)
);

CREATE INDEX IF NOT EXISTS idx_gomosub_memberships_board_id
  ON public.gomosub_memberships(board_id);

CREATE INDEX IF NOT EXISTS idx_gomosub_memberships_user_id
  ON public.gomosub_memberships(user_id);

ALTER TABLE public.gomosub_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view gomosub memberships" ON public.gomosub_memberships;
CREATE POLICY "Anyone can view gomosub memberships"
  ON public.gomosub_memberships FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can join gomosubs" ON public.gomosub_memberships;
CREATE POLICY "Users can join gomosubs"
  ON public.gomosub_memberships FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can leave their gomosubs" ON public.gomosub_memberships;
CREATE POLICY "Users can leave their gomosubs"
  ON public.gomosub_memberships FOR DELETE
  USING (user_id = auth.uid());
