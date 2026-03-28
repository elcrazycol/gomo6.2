-- Debug script to check and fix achievement levels
-- Run this in Supabase SQL Editor to see what's happening

-- First, let's see what achievements users currently have
SELECT
  ua.user_id,
  p.username,
  a.id as achievement_id,
  a.name,
  a.achievement_type,
  ua.level,
  ua.unlocked_at
FROM user_achievements ua
JOIN achievements a ON ua.achievement_id = a.id
JOIN profiles p ON ua.user_id = p.id
ORDER BY ua.user_id, a.achievement_type, ua.level DESC;

-- Check user stats
SELECT
  p.id as user_id,
  p.username,
  p.post_count,
  p.thread_count,
  COALESCE(st.total_minutes, 0) as total_minutes
FROM profiles p
LEFT JOIN user_session_time st ON st.user_id = p.id
WHERE p.id IN (SELECT DISTINCT user_id FROM user_achievements);

-- Check achievement types and categories
SELECT
  id,
  name,
  achievement_type,
  category
FROM achievements
ORDER BY achievement_type, category;

-- Check pinned achievements
SELECT
  ua.user_id,
  p.username,
  a.id as achievement_id,
  a.name,
  ua.level,
  ua.is_pinned,
  ua.pinned_order,
  ua.unlocked_at
FROM user_achievements ua
JOIN achievements a ON ua.achievement_id = a.id
JOIN profiles p ON ua.user_id = p.id
WHERE ua.is_pinned = true
ORDER BY ua.user_id, ua.pinned_order;

-- Manually recalculate levels for a specific user (replace 'user-id-here' with actual user ID)
-- You can get user ID from the profiles table
/*
SELECT recalculate_user_achievement_levels('user-id-here');
*/

-- Or recalculate for all users
/*
SELECT recalculate_all_achievement_levels();
*/

-- Check if settings changes exist
SELECT
  user_id,
  setting_name,
  changed_at
FROM user_settings_changes
WHERE setting_name = 'custom_font';

-- Check thread visits
SELECT
  tcmv.user_id,
  tcmv.thread_id,
  t.title,
  b.name as board_name,
  b.is_rules_board,
  t.custom_message IS NOT NULL AND t.custom_message != '' as has_custom_message
FROM thread_custom_message_visits tcmv
JOIN threads t ON tcmv.thread_id = t.id
JOIN boards b ON t.board_id = b.id;