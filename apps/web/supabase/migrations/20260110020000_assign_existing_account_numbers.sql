-- Assign account numbers to existing profiles that don't have them
-- This will run after the trigger is created

-- Update existing profiles with account numbers based on creation order
UPDATE public.profiles
SET account_number = sub.row_num
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as row_num
  FROM public.profiles
  WHERE account_number IS NULL
) sub
WHERE public.profiles.id = sub.id;