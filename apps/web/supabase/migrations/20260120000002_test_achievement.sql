-- Test achievement notification system

-- Test notification creation for a specific user
DO $$
DECLARE
  test_user_id UUID;
BEGIN
  -- Get first user with posts
  SELECT id INTO test_user_id
  FROM profiles
  WHERE post_count > 0
  LIMIT 1;

  IF test_user_id IS NOT NULL THEN
    -- Create a test achievement notification
    INSERT INTO notifications (user_id, type, title, message)
    VALUES (
      test_user_id,
      'achievement',
      'Тестовое достижение!',
      'Это тестовое уведомление о достижении'
    );
  END IF;
END $$;