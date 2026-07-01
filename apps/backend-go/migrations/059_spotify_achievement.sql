-- Spotify integration achievement (one-time)
INSERT INTO achievements (id, group_key, name, title, description, category, icon, rarity, achievement_type, hidden, sort_order, levels) VALUES
  ('a0000001-1011-4011-8011-000000000011', 'spotify', 'Spotify', 'Spotify', 'Подключение Spotify', 'integrations', 'music',
   'rare', 'one_time', FALSE, 11,
   '[
     {"level": 1, "threshold": 1, "name": "Меломан", "description": "Подключить Spotify в интеграциях", "rarity": "rare", "reward_type": "garma", "reward_value": "50"}
   ]'::jsonb);
