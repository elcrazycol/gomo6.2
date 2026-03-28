-- Add gomo sub (user boards) support

-- 1) Extend boards with user-generated metadata
ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS is_gomosub BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS rules_markdown TEXT,
  ADD COLUMN IF NOT EXISTS rules_updated_at TIMESTAMPTZ;

-- Ensure rules timestamp is populated for existing rows and set default
UPDATE public.boards
SET rules_updated_at = COALESCE(rules_updated_at, NOW());

ALTER TABLE public.boards
  ALTER COLUMN rules_updated_at SET DEFAULT NOW();

-- Require owner for user-created boards
ALTER TABLE public.boards
  ADD CONSTRAINT boards_gomosub_owner_required
  CHECK (is_gomosub = false OR owner_id IS NOT NULL);

-- 2) Trigger to keep rules timestamp fresh
CREATE OR REPLACE FUNCTION public.touch_board_rules_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.rules_markdown IS DISTINCT FROM OLD.rules_markdown THEN
    NEW.rules_updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_board_rules ON public.boards;
CREATE TRIGGER trg_touch_board_rules
  BEFORE UPDATE OF rules_markdown ON public.boards
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_board_rules_timestamp();

-- 3) RLS: allow gomosub creation for users with 100+ garma, keep staff control
DROP POLICY IF EXISTS "Users with 100+ garma can create gomosubs" ON public.boards;
CREATE POLICY "Users with 100+ garma can create gomosubs"
  ON public.boards FOR INSERT
  WITH CHECK (
    is_gomosub = true
    AND owner_id = (select auth.uid())
    AND (SELECT garma FROM public.profiles WHERE id = (select auth.uid())) > 100
  );

DROP POLICY IF EXISTS "Gomosub owners can update their board" ON public.boards;
CREATE POLICY "Gomosub owners can update their board"
  ON public.boards FOR UPDATE
  USING (is_gomosub = true AND owner_id = (select auth.uid()))
  WITH CHECK (is_gomosub = true AND owner_id = (select auth.uid()));

DROP POLICY IF EXISTS "Staff can manage boards" ON public.boards;
CREATE POLICY "Staff can manage boards"
  ON public.boards FOR ALL
  USING (
    (select public.has_role(auth.uid(), 'admin'::public.app_role)) OR
    (select public.has_role(auth.uid(), 'moderator'::public.app_role))
  )
  WITH CHECK (
    (select public.has_role(auth.uid(), 'admin'::public.app_role)) OR
    (select public.has_role(auth.uid(), 'moderator'::public.app_role))
  );
