-- Simple test to verify achievement and notification system works

-- First, add a simple test achievement
INSERT INTO public.achievements (id, name, description, category, icon, achievement_type, reward_type, reward_value) VALUES
('test_achievement', 'Тестовое достижение', 'Тестовое достижение для проверки системы', 'basic', '🧪', 'posts', 'username_color', 'red')
ON CONFLICT (id) DO NOTHING;

-- Test the award_achievement_with_level function
DO $$
DECLARE
  test_user_id UUID;
BEGIN
  -- Get first user
  SELECT id INTO test_user_id
  FROM profiles
  LIMIT 1;

  IF test_user_id IS NOT NULL THEN
    -- Test achievement awarding
    PERFORM award_achievement_with_level(test_user_id, 'posts', 1);

    -- Also create a direct notification
    INSERT INTO notifications (user_id, type, title, message)
    VALUES (
      test_user_id,
      'achievement',
      'Система достижений работает!',
      'Тестовое уведомление успешно создано'
    );
  END IF;
END $$;