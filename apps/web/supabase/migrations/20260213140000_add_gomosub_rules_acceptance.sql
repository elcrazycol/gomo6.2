-- Track per-user acceptance of gomosub rules
CREATE TABLE IF NOT EXISTS public.gomosub_rules_acceptance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, board_id)
);

CREATE INDEX IF NOT EXISTS idx_gomosub_rules_acceptance_user_id
  ON public.gomosub_rules_acceptance(user_id);

CREATE INDEX IF NOT EXISTS idx_gomosub_rules_acceptance_board_id
  ON public.gomosub_rules_acceptance(board_id);

ALTER TABLE public.gomosub_rules_acceptance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own gomosub rules acceptance" ON public.gomosub_rules_acceptance;
CREATE POLICY "Users can view their own gomosub rules acceptance"
  ON public.gomosub_rules_acceptance FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert their own gomosub rules acceptance" ON public.gomosub_rules_acceptance;
CREATE POLICY "Users can insert their own gomosub rules acceptance"
  ON public.gomosub_rules_acceptance FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own gomosub rules acceptance" ON public.gomosub_rules_acceptance;
CREATE POLICY "Users can update their own gomosub rules acceptance"
  ON public.gomosub_rules_acceptance FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
