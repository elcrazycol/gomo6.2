-- Migration: Achievement system overhaul
-- Rarity: common, uncommon, rare, epic, legendary
-- Type: progressive (levels), one_time (single unlock)
-- hidden: true for secret achievements

-- Add rarity, hidden, achievement_type, sort_order to achievements
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS rarity VARCHAR(20) DEFAULT 'common';
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS achievement_type VARCHAR(20) DEFAULT 'progressive';
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Add progress tracking to user_achievements
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS progress_current INTEGER DEFAULT 0;
ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS progress_target INTEGER DEFAULT 0;

-- Clear old seed data
DELETE FROM user_achievements;
DELETE FROM achievements;

-- ============================================================
-- SEED ACHIEVEMENTS
-- ============================================================

-- POSTING (посты)
INSERT INTO achievements (id, name, description, category, icon, reward_type, reward_value, rarity, achievement_type, sort_order) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'Первое слово', 'Опубликовать первый пост', 'posting', '🗣️', 'garma', '10', 'common', 'one_time', 1),
  ('a0000001-0000-0000-0000-000000000002', 'Писатель', 'Написать 50 постов', 'posting', '📜', 'garma', '50', 'common', 'progressive', 2),
  ('a0000001-0000-0000-0000-000000000003', 'Романист', 'Написать 500 постов', 'posting', '📚', 'garma', '200', 'uncommon', 'progressive', 3),
  ('a0000001-0000-0000-0000-000000000004', 'Классик', 'Написать 5000 постов', 'posting', '🏛️', 'garma', '1000', 'rare', 'progressive', 4),
  ('a0000001-0000-0000-0000-000000000005', 'Графоман', 'Написать 10000 постов', 'posting', '✍️', 'username_color', 'purple', 'epic', 'progressive', 5);

-- THREADS
INSERT INTO achievements (id, name, description, category, icon, reward_type, reward_value, rarity, achievement_type, sort_order) VALUES
  ('a0000001-0000-0000-0000-000000000006', 'Первая нить', 'Создать первый тред', 'threads', '🧵', 'garma', '25', 'common', 'one_time', 6),
  ('a0000001-0000-0000-0000-000000000007', 'Ткач', 'Создать 10 тредов', 'threads', '🕸️', 'garma', '100', 'uncommon', 'progressive', 7),
  ('a0000001-0000-0000-0000-000000000008', 'Архитектор', 'Создать 50 тредов', 'threads', '🏗️', 'garma', '500', 'rare', 'progressive', 8),
  ('a0000001-0000-0000-0000-000000000009', 'Вселенная', 'Создать 100 тредов', 'threads', '🌐', 'username_color', 'gold', 'epic', 'progressive', 9);

-- LIKES RECEIVED
INSERT INTO achievements (id, name, description, category, icon, reward_type, reward_value, rarity, achievement_type, sort_order) VALUES
  ('a0000001-0000-0000-0000-000000000010', 'Замеченный', 'Получить первый лайк', 'likes_received', '👍', 'garma', '15', 'common', 'one_time', 10),
  ('a0000001-0000-0000-0000-000000000011', 'Популярный', 'Получить 100 лайков', 'likes_received', '⭐', 'garma', '150', 'uncommon', 'progressive', 11),
  ('a0000001-0000-0000-0000-000000000012', 'Звезда', 'Получить 1000 лайков', 'likes_received', '💫', 'garma', '1000', 'rare', 'progressive', 12),
  ('a0000001-0000-0000-0000-000000000013', 'Легенда', 'Получить 10000 лайков', 'likes_received', '👑', 'username_color', 'orange', 'legendary', 'progressive', 13);

-- LIKES GIVEN
INSERT INTO achievements (id, name, description, category, icon, reward_type, reward_value, rarity, achievement_type, sort_order) VALUES
  ('a0000001-0000-0000-0000-000000000014', 'Добрый', 'Поставить первый лайк', 'likes_given', '💚', 'garma', '5', 'common', 'one_time', 14),
  ('a0000001-0000-0000-0000-000000000015', 'Щедрый', 'Поставить 100 лайков', 'likes_given', '💝', 'garma', '50', 'uncommon', 'progressive', 15),
  ('a0000001-0000-0000-0000-000000000016', 'Меценат', 'Поставить 1000 лайков', 'likes_given', '🌟', 'garma', '500', 'rare', 'progressive', 16);

-- TIME
INSERT INTO achievements (id, name, description, category, icon, reward_type, reward_value, rarity, achievement_type, sort_order) VALUES
  ('a0000001-0000-0000-0000-000000000017', 'Посетитель', 'Провести 1 час на сайте', 'time', '⏱️', 'garma', '10', 'common', 'progressive', 17),
  ('a0000001-0000-0000-0000-000000000018', 'Завсегдатай', 'Провести 24 часа на сайте', 'time', '🕐', 'garma', '100', 'uncommon', 'progressive', 18),
  ('a0000001-0000-0000-0000-000000000019', 'Домосед', 'Провести 100 часов на сайте', 'time', '🏠', 'garma', '500', 'rare', 'progressive', 19),
  ('a0000001-0000-0000-0000-000000000020', 'Ночной житель', 'Провести 500 часов на сайте', 'time', '🌙', 'username_color', 'blue', 'epic', 'progressive', 20);

-- PROFILE
INSERT INTO achievements (id, name, description, category, icon, reward_type, reward_value, rarity, achievement_type, sort_order) VALUES
  ('a0000001-0000-0000-0000-000000000021', 'Лицо', 'Установить аватар', 'profile', '🖼️', 'garma', '20', 'common', 'one_time', 21),
  ('a0000001-0000-0000-0000-000000000022', 'О себе', 'Заполнить био', 'profile', '📝', 'garma', '15', 'common', 'one_time', 22),
  ('a0000001-0000-0000-0000-000000000023', 'Стиль', 'Кастомизировать профиль', 'profile', '🎨', 'garma', '50', 'rare', 'one_time', 23);

-- IMAGES
INSERT INTO achievements (id, name, description, category, icon, reward_type, reward_value, rarity, achievement_type, sort_order) VALUES
  ('a0000001-0000-0000-0000-000000000024', 'Фотограф', 'Загрузить первое изображение', 'images', '📸', 'garma', '10', 'common', 'one_time', 24),
  ('a0000001-0000-0000-0000-000000000025', 'Галерист', 'Загрузить 100 изображений', 'images', '🖼️', 'garma', '100', 'uncommon', 'progressive', 25),
  ('a0000001-0000-0000-0000-000000000026', 'Фотохудожник', 'Загрузить 1000 изображений', 'images', '🎞️', 'garma', '1000', 'rare', 'progressive', 26);

-- WALL
INSERT INTO achievements (id, name, description, category, icon, reward_type, reward_value, rarity, achievement_type, sort_order) VALUES
  ('a0000001-0000-0000-0000-000000000027', 'Память', 'Закрепить пост на стене', 'wall', '📌', 'garma', '10', 'common', 'one_time', 27),
  ('a0000001-0000-0000-0000-000000000028', 'Эхо', 'Сделать репост на стену', 'wall', '🔄', 'garma', '15', 'common', 'one_time', 28);

-- SECRET (hidden = true)
INSERT INTO achievements (id, name, description, category, icon, reward_type, reward_value, rarity, achievement_type, hidden, sort_order) VALUES
  ('a0000001-0000-0000-0000-000000000029', 'Ниндзя', 'Написать 10 постов анонимно', 'secret', '🥷', 'username_color', 'red', 'rare', 'progressive', TRUE, 29),
  ('a0000001-0000-0000-0000-000000000030', 'Маска', 'Получить 50 лайков будучи анонимом', 'secret', '🎭', 'garma', '300', 'epic', 'progressive', TRUE, 30);
