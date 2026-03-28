-- Add polling system to threads
-- Add poll field to threads table
ALTER TABLE public.threads ADD COLUMN IF NOT EXISTS poll JSONB;

-- Create polls table for storing poll data
CREATE TABLE IF NOT EXISTS public.polls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options JSONB NOT NULL, -- Array of {id, text} objects
  allow_multiple BOOLEAN NOT NULL DEFAULT FALSE,
  show_results BOOLEAN NOT NULL DEFAULT FALSE,
  allow_change_vote BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(thread_id)
);

-- Create poll_votes table for storing votes
CREATE TABLE IF NOT EXISTS public.poll_votes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  poll_id UUID NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  option_ids JSONB NOT NULL, -- Array of selected option IDs
  voted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(poll_id, user_id)
);

-- Enable RLS
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

-- Policies for polls
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

-- Policies for poll_votes
CREATE POLICY "Users can view poll results if allowed"
ON public.poll_votes FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.polls
    WHERE polls.id = poll_votes.poll_id
    AND polls.show_results = true
  )
  OR auth.uid() = user_id
);

CREATE POLICY "Users can vote on polls"
ON public.poll_votes FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can change their votes if allowed"
ON public.poll_votes FOR UPDATE
USING (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.polls
    WHERE polls.id = poll_votes.poll_id
    AND polls.allow_change_vote = true
  )
);

CREATE POLICY "Users can delete their votes if allowed"
ON public.poll_votes FOR DELETE
USING (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.polls
    WHERE polls.id = poll_votes.poll_id
    AND polls.allow_change_vote = true
  )
);

-- Create indexes
CREATE INDEX IF NOT EXISTS polls_thread_id_idx ON public.polls(thread_id);
CREATE INDEX IF NOT EXISTS poll_votes_poll_id_idx ON public.poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS poll_votes_user_id_idx ON public.poll_votes(user_id);

-- Function to create poll from thread data
CREATE OR REPLACE FUNCTION create_poll_from_thread_data()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.poll IS NOT NULL THEN
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
      (NEW.poll->>'allow_multiple')::boolean,
      (NEW.poll->>'show_results')::boolean,
      (NEW.poll->>'allow_change_vote')::boolean
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create poll when thread is created with poll data
DROP TRIGGER IF EXISTS create_poll_on_thread_insert ON public.threads;
CREATE TRIGGER create_poll_on_thread_insert
  AFTER INSERT ON public.threads
  FOR EACH ROW
  EXECUTE FUNCTION create_poll_from_thread_data();