-- Fix night thread validation logic
-- The original logic was inverted, rejecting valid hours instead of invalid ones

CREATE OR REPLACE FUNCTION validate_night_thread_creation() RETURNS TRIGGER AS $$
BEGIN
  -- Allow night threads only between 23:00 and 05:59
  IF NEW.tags->>'flag' = 'night' THEN
    -- Check if current hour is NOT in allowed range (23 or 0-5)
    IF NOT (EXTRACT(HOUR FROM NOW()) = 23 OR EXTRACT(HOUR FROM NOW()) BETWEEN 0 AND 5) THEN
      RAISE EXCEPTION 'Night threads can only be created between 23:00 and 06:00';
    END IF;
  END IF;

  -- Process ephemeral thread
  IF NEW.tags->>'flag' = 'ephemeral' THEN
    -- This will be called from the application after thread creation
    NULL;
  END IF;

  -- Process night thread
  IF NEW.tags->>'flag' = 'night' THEN
    PERFORM process_night_thread(NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger to ensure it uses the updated function
DROP TRIGGER IF EXISTS validate_night_thread_creation_trigger ON threads;
CREATE TRIGGER validate_night_thread_creation_trigger
  BEFORE INSERT ON threads
  FOR EACH ROW
  EXECUTE FUNCTION validate_night_thread_creation();
