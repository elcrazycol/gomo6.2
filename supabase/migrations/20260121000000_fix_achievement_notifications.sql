-- Fix achievement notifications to prevent duplicates
-- The issue: check_post_count_achievements creates notifications manually,
-- but there's also a trigger notify_achievement_trigger that creates notifications on INSERT.
-- This causes duplicate notifications.

-- Solution: Remove manual notification creation from check_post_count_achievements
-- and let the trigger handle it. But we need to ensure the trigger only fires on new achievements.

-- First, update the trigger to only fire on INSERT (not UPDATE)
-- The trigger already only fires on INSERT, so that's good.

-- Now, remove the manual notification creation from check_post_count_achievements
CREATE OR REPLACE FUNCTION public.check_post_count_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  post_count INTEGER;
  achievement_level INTEGER := 1;
  was_inserted BOOLEAN := false;
BEGIN
  -- Get user's post count
  SELECT COALESCE(p.post_count, 0) INTO post_count
  FROM profiles p
  WHERE p.id = NEW.user_id;

  -- Determine level based on post count
  IF post_count >= 1000 THEN
    achievement_level := 17;
  ELSIF post_count >= 900 THEN
    achievement_level := 16;
  ELSIF post_count >= 800 THEN
    achievement_level := 15;
  ELSIF post_count >= 700 THEN
    achievement_level := 14;
  ELSIF post_count >= 600 THEN
    achievement_level := 13;
  ELSIF post_count >= 500 THEN
    achievement_level := 12;
  ELSIF post_count >= 400 THEN
    achievement_level := 11;
  ELSIF post_count >= 350 THEN
    achievement_level := 10;
  ELSIF post_count >= 300 THEN
    achievement_level := 9;
  ELSIF post_count >= 250 THEN
    achievement_level := 8;
  ELSIF post_count >= 200 THEN
    achievement_level := 7;
  ELSIF post_count >= 150 THEN
    achievement_level := 6;
  ELSIF post_count >= 100 THEN
    achievement_level := 5;
  ELSIF post_count >= 75 THEN
    achievement_level := 4;
  ELSIF post_count >= 50 THEN
    achievement_level := 3;
  ELSIF post_count >= 25 THEN
    achievement_level := 2;
  ELSIF post_count >= 10 THEN
    achievement_level := 1;
  END IF;

  IF achievement_level >= 1 THEN
    -- Award the achievement
    -- This will INSERT into user_achievements if it's a new achievement,
    -- which will trigger notify_achievement_trigger to create the notification.
    -- If it's an UPDATE (level upgrade), no notification will be created (trigger only fires on INSERT).
    PERFORM award_achievement_with_level(NEW.user_id, 'posts', achievement_level);
    
    -- Note: Notifications are created by the notify_achievement_trigger on INSERT only.
    -- We removed manual notification creation here to prevent duplicates.
  END IF;

  RETURN NEW;
END;
$$;

-- Update notify_achievement trigger to ensure it only creates notifications for new achievements
-- The trigger already only fires on INSERT, so it should be fine, but let's make sure
-- it doesn't create duplicate notifications by checking if notification already exists
CREATE OR REPLACE FUNCTION public.notify_achievement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  achievement_name TEXT;
  achievement_icon TEXT;
  existing_notification_id UUID;
BEGIN
  -- Get achievement details
  SELECT name, icon INTO achievement_name, achievement_icon
  FROM public.achievements
  WHERE id = NEW.achievement_id;
  
  -- Check if notification for this achievement was already created recently (within last minute)
  -- This prevents duplicates from rapid inserts
  SELECT id INTO existing_notification_id
  FROM public.notifications
  WHERE user_id = NEW.user_id
    AND type = 'achievement'
    AND created_at > NOW() - INTERVAL '1 minute'
    AND message LIKE '%' || achievement_name || '%'
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- Only create notification if it doesn't exist
  IF existing_notification_id IS NULL THEN
    -- Create notification
    INSERT INTO public.notifications (user_id, type, title, message, related_post_id, related_thread_id)
    VALUES (
      NEW.user_id,
      'achievement',
      'Новое достижение!',
      achievement_icon || ' Вы получили достижение "' || achievement_name || '"',
      NULL,
      NULL
    );
  END IF;
  
  RETURN NEW;
END;
$$;
