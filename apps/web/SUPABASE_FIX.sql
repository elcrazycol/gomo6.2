-- Execute this in Supabase SQL Editor to fix account numbers

-- First, add the column if it doesn't exist
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS account_number INTEGER;

-- Create index if it doesn't exist
CREATE INDEX IF NOT EXISTS profiles_account_number_idx ON public.profiles(account_number);

-- Assign account numbers to existing profiles
UPDATE public.profiles
SET account_number = sub.row_num
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as row_num
  FROM public.profiles
  WHERE account_number IS NULL
) sub
WHERE public.profiles.id = sub.id;

-- Create or replace the function
CREATE OR REPLACE FUNCTION assign_account_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_number IS NULL THEN
    NEW.account_number := COALESCE(
      (SELECT MAX(account_number) FROM public.profiles), 0
    ) + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create or replace the trigger
DROP TRIGGER IF EXISTS assign_account_number_trigger ON public.profiles;
CREATE TRIGGER assign_account_number_trigger
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION assign_account_number();