-- Add support for ephemeral and night threads
-- Ephemeral threads auto-delete after time/messages threshold
-- Night threads auto-delete at 6 AM

ALTER TABLE threads ADD COLUMN IF NOT EXISTS ephemeral_type TEXT CHECK (ephemeral_type IN ('time', 'messages'));
ALTER TABLE threads ADD COLUMN IF NOT EXISTS ephemeral_value INTEGER;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS auto_delete_at TIMESTAMP WITH TIME ZONE;

-- Update existing threads to have normal flag if not set
UPDATE threads SET tags = tags || '{"flag": "normal"}'::jsonb WHERE tags->>'flag' IS NULL;

-- Function to schedule thread deletion
CREATE OR REPLACE FUNCTION schedule_thread_deletion(thread_id UUID, delete_at TIMESTAMP WITH TIME ZONE)
RETURNS VOID AS $$
BEGIN
  UPDATE threads SET auto_delete_at = delete_at WHERE id = thread_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to process ephemeral thread creation
CREATE OR REPLACE FUNCTION process_ephemeral_thread(
  p_thread_id UUID,
  p_ephemeral_type TEXT,
  p_ephemeral_value INTEGER
) RETURNS VOID AS $$
DECLARE
  delete_timestamp TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Calculate deletion time
  IF p_ephemeral_type = 'time' THEN
    delete_timestamp := NOW() + INTERVAL '1 hour' * p_ephemeral_value;
  ELSE
    -- For message-based, we'll handle this via triggers on posts
    delete_timestamp := NOW() + INTERVAL '7 days'; -- Default fallback
  END IF;

  -- Schedule deletion
  PERFORM schedule_thread_deletion(p_thread_id, delete_timestamp);

  -- Note: No initial post created for ephemeral threads
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to process night thread creation
CREATE OR REPLACE FUNCTION process_night_thread(p_thread_id UUID) RETURNS VOID AS $$
DECLARE
  delete_at TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Calculate 6 AM of the next day
  delete_at := DATE_TRUNC('day', NOW() + INTERVAL '1 day') + INTERVAL '6 hours';

  -- Schedule deletion
  PERFORM schedule_thread_deletion(p_thread_id, delete_at);

  -- Create initial post about night thread
  INSERT INTO posts (thread_id, user_id, content, is_night_notice)
  VALUES (
    p_thread_id,
    (SELECT user_id FROM threads WHERE id = p_thread_id),
    '🌙 Этот ночной тред будет автоматически удалён в 6:00 утра. Приятных снов! 😴',
    true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to validate night thread creation time
CREATE OR REPLACE FUNCTION validate_night_thread_creation() RETURNS TRIGGER AS $$
BEGIN
  -- Allow night threads only between 23:00 and 06:00
  IF NEW.tags->>'flag' = 'night' THEN
    IF EXTRACT(HOUR FROM NOW()) NOT BETWEEN 23 AND 24 AND EXTRACT(HOUR FROM NOW()) NOT BETWEEN 0 AND 5 THEN
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

-- Create trigger for night thread validation
DROP TRIGGER IF EXISTS validate_night_thread_creation_trigger ON threads;
CREATE TRIGGER validate_night_thread_creation_trigger
  BEFORE INSERT ON threads
  FOR EACH ROW
  EXECUTE FUNCTION validate_night_thread_creation();

-- Function to check and delete expired threads
CREATE OR REPLACE FUNCTION delete_expired_threads() RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
  thread_record RECORD;
BEGIN
  -- Find expired threads
  FOR thread_record IN
    SELECT id, title, ephemeral_type, ephemeral_value, auto_delete_at
    FROM threads
    WHERE auto_delete_at IS NOT NULL AND auto_delete_at <= NOW()
  LOOP
    -- Create deletion notice post before deletion
    INSERT INTO posts (thread_id, user_id, content, is_deletion_notice)
    SELECT
      thread_record.id,
      user_id,
      CASE
        WHEN ephemeral_type = 'time' THEN '⏰ Временный тред удалён по истечении времени.'
        WHEN ephemeral_type = 'messages' THEN '⏰ Временный тред удалён по достижении лимита сообщений.'
        ELSE '🌙 Ночной тред удалён в 6:00 утра.'
      END,
      true
    FROM threads WHERE id = thread_record.id;

    -- Delete the thread (posts will be cascade deleted)
    DELETE FROM threads WHERE id = thread_record.id;
    deleted_count := deleted_count + 1;
  END LOOP;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check message-based ephemeral threads
CREATE OR REPLACE FUNCTION check_message_based_ephemeral() RETURNS TRIGGER AS $$
DECLARE
  thread_ephemeral_value INTEGER;
  current_post_count INTEGER;
BEGIN
  -- Check if this thread is message-based ephemeral
  SELECT ephemeral_value INTO thread_ephemeral_value
  FROM threads
  WHERE id = NEW.thread_id AND ephemeral_type = 'messages';

  IF thread_ephemeral_value IS NOT NULL THEN
    -- Count posts in thread (excluding system notices)
    SELECT COUNT(*) INTO current_post_count
    FROM posts
    WHERE thread_id = NEW.thread_id
    AND is_ephemeral_notice IS NOT TRUE
    AND is_night_notice IS NOT TRUE
    AND is_deletion_notice IS NOT TRUE;

    -- If limit reached, schedule immediate deletion
    IF current_post_count >= thread_ephemeral_value THEN
      UPDATE threads
      SET auto_delete_at = NOW()
      WHERE id = NEW.thread_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for message-based ephemeral threads
DROP TRIGGER IF EXISTS check_message_ephemeral_trigger ON posts;
CREATE TRIGGER check_message_ephemeral_trigger
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION check_message_based_ephemeral();

-- Add columns to posts for system notices
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_ephemeral_notice BOOLEAN DEFAULT FALSE;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_night_notice BOOLEAN DEFAULT FALSE;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_deletion_notice BOOLEAN DEFAULT FALSE;

-- Create index for efficient deletion checks
CREATE INDEX IF NOT EXISTS idx_threads_auto_delete_at ON threads(auto_delete_at) WHERE auto_delete_at IS NOT NULL;

-- Grant permissions
GRANT EXECUTE ON FUNCTION schedule_thread_deletion(UUID, TIMESTAMP WITH TIME ZONE) TO authenticated;
GRANT EXECUTE ON FUNCTION process_ephemeral_thread(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION process_night_thread(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_expired_threads() TO authenticated;