-- Fix polling system - ensure tables exist and data is preserved

-- Create polls table if not exists
CREATE TABLE IF NOT EXISTS public.polls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options JSONB NOT NULL,
  allow_multiple BOOLEAN NOT NULL DEFAULT FALSE,
  show_results BOOLEAN NOT NULL DEFAULT FALSE,
  allow_change_vote BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create poll_votes table if not exists
CREATE TABLE IF NOT EXISTS public.poll_votes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  poll_id UUID NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  option_ids JSONB NOT NULL,
  voted_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can view polls" ON public.polls;
DROP POLICY IF EXISTS "Users can create polls for their threads" ON public.polls;
DROP POLICY IF EXISTS "Thread authors can update their polls" ON public.polls;
DROP POLICY IF EXISTS "Users can view poll results if allowed" ON public.poll_votes;
DROP POLICY IF EXISTS "Users can vote on polls" ON public.poll_votes;
DROP POLICY IF EXISTS "Users can change their votes if allowed" ON public.poll_votes;
DROP POLICY IF EXISTS "Users can delete their votes if allowed" ON public.poll_votes;

-- Create policies for polls
CREATE POLICY "Anyone can view polls"
ON public.polls FOR SELECT
USING (true);

CREATE POLICY "Users can create polls for their threads"
ON public.polls FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.threads
    WHERE threads.id = polls.thread_id
    AND threads.user_id = auth.uid()
  )
);

CREATE POLICY "Thread authors can update their polls"
ON public.polls FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.threads
    WHERE threads.id = polls.thread_id
    AND threads.user_id = auth.uid()
  )
);

-- Create policies for poll_votes
DROP POLICY IF EXISTS "Users can view poll results if allowed" ON public.poll_votes;
DROP POLICY IF EXISTS "Users can vote on polls" ON public.poll_votes;
DROP POLICY IF EXISTS "Users can change their votes if allowed" ON public.poll_votes;
DROP POLICY IF EXISTS "Users can delete their votes if allowed" ON public.poll_votes;
DROP POLICY IF EXISTS "Users can insert their own votes" ON public.poll_votes;
DROP POLICY IF EXISTS "Users can update their own votes" ON public.poll_votes;
DROP POLICY IF EXISTS "Users can delete their own votes" ON public.poll_votes;
DROP POLICY IF EXISTS "View poll votes conditionally" ON public.poll_votes;

-- Policy for SELECT - users can see results based on poll settings
CREATE POLICY "View poll votes conditionally"
ON public.poll_votes FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.polls
    WHERE polls.id = poll_votes.poll_id
    AND (
      polls.show_results = true
      OR poll_votes.user_id = auth.uid()
    )
  )
);

-- Simple policy for INSERT - users can insert their own votes
CREATE POLICY "Users can insert their own votes"
ON public.poll_votes FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Simple policy for UPDATE - users can update their own votes
CREATE POLICY "Users can update their own votes"
ON public.poll_votes FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Simple policy for DELETE - users can delete their own votes
CREATE POLICY "Users can delete their own votes"
ON public.poll_votes FOR DELETE
USING (auth.uid() = user_id);

-- Create indexes
CREATE INDEX IF NOT EXISTS polls_thread_id_idx ON public.polls(thread_id);
CREATE INDEX IF NOT EXISTS poll_votes_poll_id_idx ON public.poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS poll_votes_user_id_idx ON public.poll_votes(user_id);

-- Add unique constraints
ALTER TABLE public.polls DROP CONSTRAINT IF EXISTS polls_thread_id_key;
ALTER TABLE public.polls ADD CONSTRAINT polls_thread_id_key UNIQUE (thread_id);

ALTER TABLE public.poll_votes DROP CONSTRAINT IF EXISTS poll_votes_poll_id_user_id_key;
ALTER TABLE public.poll_votes ADD CONSTRAINT poll_votes_poll_id_user_id_key UNIQUE (poll_id, user_id);

-- Create function to get poll results
CREATE OR REPLACE FUNCTION get_poll_results(poll_uuid uuid)
RETURNS TABLE(option_id text, votes bigint, total_votes bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    jsonb_array_elements_text(option_ids) AS option_id,
    COUNT(*) AS votes,
    SUM(COUNT(*)) OVER () AS total_votes
  FROM poll_votes
  WHERE poll_id = poll_uuid
  GROUP BY option_id
  ORDER BY option_id;
$$;

-- Fix thread_custom_message_visits RLS policies
DROP POLICY IF EXISTS "Users can view their own thread visits" ON public.thread_custom_message_visits;
DROP POLICY IF EXISTS "Users can insert their own thread visits" ON public.thread_custom_message_visits;
DROP POLICY IF EXISTS "Users can update their own thread visits" ON public.thread_custom_message_visits;

CREATE POLICY "Users can view their own thread visits"
ON public.thread_custom_message_visits FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own thread visits"
ON public.thread_custom_message_visits FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own thread visits"
ON public.thread_custom_message_visits FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Add unique constraint for poll votes if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poll_votes_poll_id_user_id_key'
  ) THEN
    ALTER TABLE public.poll_votes ADD CONSTRAINT poll_votes_poll_id_user_id_key UNIQUE (poll_id, user_id);
  END IF;
END $$;

-- Function to create poll from thread data (recreate if needed)
CREATE OR REPLACE FUNCTION create_poll_from_thread_data()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.poll IS NOT NULL AND jsonb_typeof(NEW.poll) = 'object' THEN
    INSERT INTO public.polls (
      thread_id,
      question,
      options,
      allow_multiple,
      show_results,
      allow_change_vote
    ) VALUES (
      NEW.id,
      NEW.poll->>'question',
      NEW.poll->'options',
      COALESCE((NEW.poll->>'allow_multiple')::boolean, false),
      COALESCE((NEW.poll->>'show_results')::boolean, false),
      COALESCE((NEW.poll->>'allow_change_vote')::boolean, false)
    ) ON CONFLICT (thread_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger
DROP TRIGGER IF EXISTS create_poll_on_thread_insert ON public.threads;
CREATE TRIGGER create_poll_on_thread_insert
  AFTER INSERT ON public.threads
  FOR EACH ROW
  EXECUTE FUNCTION create_poll_from_thread_data();

-- Migrate existing poll data from threads to polls table
INSERT INTO public.polls (
  thread_id,
  question,
  options,
  allow_multiple,
  show_results,
  allow_change_vote
)
SELECT
  id as thread_id,
  poll->>'question' as question,
  poll->'options' as options,
  COALESCE((poll->>'allow_multiple')::boolean, false) as allow_multiple,
  COALESCE((poll->>'show_results')::boolean, false) as show_results,
  COALESCE((poll->>'allow_change_vote')::boolean, false) as allow_change_vote
FROM public.threads
WHERE poll IS NOT NULL
  AND jsonb_typeof(poll) = 'object'
  AND NOT EXISTS (
    SELECT 1 FROM public.polls WHERE polls.thread_id = threads.id
  );