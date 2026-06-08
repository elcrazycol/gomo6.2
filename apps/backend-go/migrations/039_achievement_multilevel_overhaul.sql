-- Migration: Achievement multi-level overhaul
-- Replaces individual milestone achievements with grouped multi-level ones.
-- Each achievement group has one row in "achievements", with a "levels" JSONB array.
-- user_achievements stores current_level and progress_current.

-- ============================================================
-- PHASE 1: Add new columns
-- ============================================================
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS group_key TEXT;
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS levels JSONB DEFAULT '[]'::jsonb;

-- Rename level -> current_level in user_achievements for clarity
ALTER TABLE user_achievements RENAME COLUMN level TO current_level;

-- Ensure progress columns exist
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS progress_current INTEGER DEFAULT 0;
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS progress_target INTEGER DEFAULT 0;

-- ============================================================
-- PHASE 2: Clear old data
-- ============================================================
DELETE FROM user_achievements;
DELETE FROM achievements;

-- ============================================================
-- PHASE 3: Seed new multi-level achievements
-- ============================================================

-- POSTING (посты)
INSERT INTO achievements (id, group_key, title, description, category, icon, rarity, achievement_type, hidden, sort_order, levels) VALUES
  ('a0000001-1001-4001-8001-000000000001', 'posting', 'Посты', 'Публикация постов', 'posting', 'message-square',
   'common', 'progressive', FALSE, 1,
   '[
     {"level": 1, "threshold": 1,    "name": "Первое слово", "description": "Опубликовать первый пост",               "rarity": "common",    "reward_type": "garma",          "reward_value": "10"},
     {"level": 2, "threshold": 50,   "name": "Писатель",     "description": "Опубликовать 50 постов",                 "rarity": "uncommon",  "reward_type": "garma",          "reward_value": "50"},
     {"level": 3, "threshold": 500,  "name": "Романист",     "description": "Опубликовать 500 постов",                "rarity": "rare",      "reward_type": "garma",          "reward_value": "200"},
     {"level": 4, "threshold": 5000, "name": "Классик",      "description": "Опубликовать 5000 постов",               "rarity": "epic",      "reward_type": "garma",          "reward_value": "1000"},
     {"level": 5, "threshold": 10000,"name": "Графоман",     "description": "Опубликовать 10000 постов",              "rarity": "legendary", "reward_type": "username_color", "reward_value": "purple"}
   ]'::jsonb);

-- THREADS
INSERT INTO achievements (id, group_key, title, description, category, icon, rarity, achievement_type, hidden, sort_order, levels) VALUES
  ('a0000001-1002-4002-8002-000000000002', 'threads', 'Треды', 'Создание тредов', 'threads', 'layers',
   'common', 'progressive', FALSE, 2,
   '[
     {"level": 1, "threshold": 1,   "name": "Первая нить", "description": "Создать первый тред",                 "rarity": "common",   "reward_type": "garma",          "reward_value": "25"},
     {"level": 2, "threshold": 10,  "name": "Ткач",        "description": "Создать 10 тредов",                   "rarity": "uncommon", "reward_type": "garma",          "reward_value": "100"},
     {"level": 3, "threshold": 50,  "name": "Архитектор",  "description": "Создать 50 тредов",                   "rarity": "rare",     "reward_type": "garma",          "reward_value": "500"},
     {"level": 4, "threshold": 100, "name": "Вселенная",   "description": "Создать 100 тредов",                  "rarity": "epic",     "reward_type": "username_color", "reward_value": "gold"}
   ]'::jsonb);

-- LIKES RECEIVED
INSERT INTO achievements (id, group_key, title, description, category, icon, rarity, achievement_type, hidden, sort_order, levels) VALUES
  ('a0000001-1003-4003-8003-000000000003', 'likes_received', 'Признание', 'Получение лайков', 'likes_received', 'heart',
   'common', 'progressive', FALSE, 3,
   '[
     {"level": 1, "threshold": 1,     "name": "Замеченный",  "description": "Получить первый лайк",                "rarity": "common",    "reward_type": "garma",          "reward_value": "15"},
     {"level": 2, "threshold": 100,   "name": "Популярный",  "description": "Получить 100 лайков",                 "rarity": "uncommon",  "reward_type": "garma",          "reward_value": "150"},
     {"level": 3, "threshold": 1000,  "name": "Звезда",      "description": "Получить 1000 лайков",                "rarity": "rare",      "reward_type": "garma",          "reward_value": "1000"},
     {"level": 4, "threshold": 10000, "name": "Легенда",     "description": "Получить 10000 лайков",               "rarity": "legendary", "reward_type": "username_color", "reward_value": "orange"}
   ]'::jsonb);

-- LIKES GIVEN
INSERT INTO achievements (id, group_key, title, description, category, icon, rarity, achievement_type, hidden, sort_order, levels) VALUES
  ('a0000001-1004-4004-8004-000000000004', 'likes_given', 'Щедрость', 'Раздача лайков', 'likes_given', 'thumbs-up',
   'common', 'progressive', FALSE, 4,
   '[
     {"level": 1, "threshold": 1,    "name": "Добрый",   "description": "Поставить первый лайк",                 "rarity": "common",   "reward_type": "garma", "reward_value": "5"},
     {"level": 2, "threshold": 100,  "name": "Щедрый",   "description": "Поставить 100 лайков",                  "rarity": "uncommon", "reward_type": "garma", "reward_value": "50"},
     {"level": 3, "threshold": 1000, "name": "Меценат",  "description": "Поставить 1000 лайков",                 "rarity": "rare",     "reward_type": "garma", "reward_value": "500"}
   ]'::jsonb);

-- IMAGES
INSERT INTO achievements (id, group_key, title, description, category, icon, rarity, achievement_type, hidden, sort_order, levels) VALUES
  ('a0000001-1005-4005-8005-000000000005', 'images', 'Галерея', 'Загрузка изображений', 'images', 'image',
   'common', 'progressive', FALSE, 5,
   '[
     {"level": 1, "threshold": 1,    "name": "Фотограф",      "description": "Загрузить первое изображение",       "rarity": "common",   "reward_type": "garma", "reward_value": "10"},
     {"level": 2, "threshold": 100,  "name": "Галерист",      "description": "Загрузить 100 изображений",          "rarity": "uncommon", "reward_type": "garma", "reward_value": "100"},
     {"level": 3, "threshold": 1000, "name": "Фотохудожник",  "description": "Загрузить 1000 изображений",         "rarity": "rare",     "reward_type": "garma", "reward_value": "1000"}
   ]'::jsonb);

-- PROFILE: Avatar
INSERT INTO achievements (id, group_key, title, description, category, icon, rarity, achievement_type, hidden, sort_order, levels) VALUES
  ('a0000001-1006-4006-8006-000000000006', 'avatar', 'Аватар', 'Установка аватара', 'profile', 'camera',
   'common', 'one_time', FALSE, 6,
   '[
     {"level": 1, "threshold": 1, "name": "Лицо", "description": "Установить аватар", "rarity": "common", "reward_type": "garma", "reward_value": "20"}
   ]'::jsonb);

-- PROFILE: Bio
INSERT INTO achievements (id, group_key, title, description, category, icon, rarity, achievement_type, hidden, sort_order, levels) VALUES
  ('a0000001-1007-4007-8007-000000000007', 'bio', 'Биография', 'Заполнение био', 'profile', 'file-text',
   'common', 'one_time', FALSE, 7,
   '[
     {"level": 1, "threshold": 1, "name": "О себе", "description": "Заполнить информацию о себе", "rarity": "common", "reward_type": "garma", "reward_value": "15"}
   ]'::jsonb);

-- PROFILE: Customization
INSERT INTO achievements (id, group_key, title, description, category, icon, rarity, achievement_type, hidden, sort_order, levels) VALUES
  ('a0000001-1008-4008-8008-000000000008', 'style', 'Стиль', 'Кастомизация профиля', 'profile', 'palette',
   'rare', 'one_time', FALSE, 8,
   '[
     {"level": 1, "threshold": 1, "name": "Стиль", "description": "Кастомизировать оформление профиля", "rarity": "rare", "reward_type": "garma", "reward_value": "50"}
   ]'::jsonb);

-- SECRET: Hidden achievement for giving many likes
INSERT INTO achievements (id, group_key, title, description, category, icon, rarity, achievement_type, hidden, sort_order, levels) VALUES
  ('a0000001-1009-4009-8009-000000000009', 'secret_likes', '???', '???', 'secret', 'sparkles',
   'epic', 'progressive', TRUE, 9,
   '[
     {"level": 1, "threshold": 500, "name": "Тайный поклонник", "description": "Поставить 500 лайков", "rarity": "epic", "reward_type": "garma", "reward_value": "500"}
   ]'::jsonb);

-- SECRET: Hidden achievement for many posts
INSERT INTO achievements (id, group_key, title, description, category, icon, rarity, achievement_type, hidden, sort_order, levels) VALUES
  ('a0000001-1010-4010-8010-000000000010', 'secret_posts', '???', '???', 'secret', 'zap',
   'epic', 'progressive', TRUE, 10,
   '[
     {"level": 1, "threshold": 2000, "name": "Бессонный", "description": "Опубликовать 2000 постов", "rarity": "epic", "reward_type": "garma", "reward_value": "800"}
   ]'::jsonb);
