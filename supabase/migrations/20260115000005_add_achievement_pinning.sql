-- Add achievement pinning functionality

-- Add pinning fields to user_achievements
ALTER TABLE public.user_achievements
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS pinned_order INTEGER;

-- Create index for efficient querying of pinned achievements
CREATE INDEX IF NOT EXISTS idx_user_achievements_pinned
ON public.user_achievements(user_id, is_pinned, pinned_order)
WHERE is_pinned = true;

-- Function to pin/unpin achievements
CREATE OR REPLACE FUNCTION public.toggle_achievement_pin(
  _user_id uuid,
  _achievement_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_pinned BOOLEAN;
  current_order INTEGER;
  max_order INTEGER;
BEGIN
  -- Get current state
  SELECT is_pinned, pinned_order
  INTO current_pinned, current_order
  FROM user_achievements
  WHERE user_id = _user_id AND achievement_id = _achievement_id;

  IF current_pinned IS NULL THEN
    -- Achievement not found
    RETURN false;
  END IF;

  IF current_pinned THEN
    -- Unpin the achievement
    UPDATE user_achievements
    SET is_pinned = false, pinned_order = NULL
    WHERE user_id = _user_id AND achievement_id = _achievement_id;

    -- Shift down other pinned achievements
    UPDATE user_achievements
    SET pinned_order = pinned_order - 1
    WHERE user_id = _user_id
      AND is_pinned = true
      AND pinned_order > current_order;

    RETURN false; -- Now unpinned
  ELSE
    -- Pin the achievement - check limit
    SELECT COUNT(*) INTO max_order
    FROM user_achievements
    WHERE user_id = _user_id AND is_pinned = true;

    IF max_order >= 4 THEN
      -- Already have 4 pinned achievements
      RETURN false;
    END IF;

    -- Get next order number
    SELECT COALESCE(MAX(pinned_order), 0) + 1 INTO max_order
    FROM user_achievements
    WHERE user_id = _user_id AND is_pinned = true;

    -- Pin the achievement
    UPDATE user_achievements
    SET is_pinned = true, pinned_order = max_order
    WHERE user_id = _user_id AND achievement_id = _achievement_id;

    RETURN true; -- Now pinned
  END IF;
END;
$$;

-- Function to reorder pinned achievements
CREATE OR REPLACE FUNCTION public.reorder_pinned_achievements(
  _user_id uuid,
  _achievement_orders JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  achievement_record RECORD;
BEGIN
  -- Update order for each achievement in the JSON
  FOR achievement_record IN
    SELECT key as achievement_id, value::integer as new_order
    FROM jsonb_each_text(_achievement_orders)
  LOOP
    UPDATE user_achievements
    SET pinned_order = achievement_record.new_order
    WHERE user_id = _user_id
      AND achievement_id = achievement_record.achievement_id
      AND is_pinned = true;
  END LOOP;
END;
$$;