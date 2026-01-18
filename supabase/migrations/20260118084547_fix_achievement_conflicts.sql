-- Fix achievement conflicts and ensure all achievements exist

-- Drop conflicting triggers and functions
DROP TRIGGER IF EXISTS check_image_achievements ON posts;
DROP TRIGGER IF EXISTS on_post_with_image ON posts;
DROP TRIGGER IF EXISTS on_post_created_check_image ON posts;
DROP FUNCTION IF EXISTS public.check_image_achievement() CASCADE;

-- Ensure all required achievements exist
INSERT INTO public.achievements (id, name, description, category, reward_type, reward_value, icon, achievement_type) VALUES
-- Posts achievements
('posts_1', 'Первый пост', 'Написал первый пост', 'basic', null, null, '💬', 'posts'),
('posts_10', 'Первые 10 сообщений', 'Написал 10 сообщений', 'basic', null, null, '🔟', 'posts'),
('posts_25', 'Первые 25 сообщений', 'Написал 25 сообщений', 'basic', null, null, '💬', 'posts'),
('posts_50', 'Первые 50 сообщений', 'Написал 50 сообщений', 'basic', null, null, '📝', 'posts'),
('posts_75', 'Первые 75 сообщений', 'Написал 75 сообщений', 'basic', null, null, '📝', 'posts'),
('posts_100', 'Первые 100 сообщений', 'Написал 100 сообщений', 'basic', null, null, '💯', 'posts'),
('posts_250', 'Болтливый', 'Написал 250 сообщений', 'basic', null, null, '💬', 'posts'),
('posts_500', 'Многословный', 'Написал 500 сообщений', 'basic', null, null, '📝', 'posts'),
('posts_1000', 'Кладезь мудрости', 'Написал 1000 сообщений', 'rare', null, null, '📚', 'posts'),

-- Threads achievements
('threads_1', 'Первый тред', 'Создал первый тред', 'basic', null, null, '🎯', 'threads'),
('threads_5', 'Создатель', 'Создал 5 тредов', 'basic', null, null, '🎯', 'threads'),
('threads_10', 'Творец', 'Создал 10 тредов', 'basic', null, null, '✨', 'threads'),
('threads_25', 'Генератор идей', 'Создал 25 тредов', 'social', null, null, '💡', 'threads'),
('threads_50', 'Архитектор сообщества', 'Создал 50 тредов', 'social', null, null, '🏗️', 'threads'),
('threads_80', 'Мастер дискуссий', 'Создал 80 тредов', 'rare', null, null, '🗣️', 'threads'),
('threads_100', 'Легенда форума', 'Создал 100 тредов', 'rare', null, null, '🌟', 'threads'),

-- Images achievements
('images_1', 'Первое изображение', 'Загрузил первое изображение', 'basic', null, null, '🖼️', 'images'),
('images_10', 'Фотолюбитель', 'Загрузил 10 изображений', 'basic', null, null, '📷', 'images'),
('images_25', 'Фотограф', 'Загрузил 25 изображений', 'basic', null, null, '📷', 'images'),
('images_50', 'Профессионал', 'Загрузил 50 изображений', 'social', null, null, '📸', 'images'),
('images_75', 'Мастер фотографии', 'Загрузил 75 изображений', 'social', null, null, '📸', 'images'),
('images_100', 'Фотограф', 'Загрузил 100 изображений', 'rare', null, null, '📷', 'images'),
('images_250', 'Художник', 'Загрузил 250 изображений', 'rare', null, null, '🎨', 'images'),
('images_500', 'Легенда', 'Загрузил 500 изображений', 'mythic', null, null, '👑', 'images'),
('images_1000', 'Бог фотографии', 'Загрузил 1000 изображений', 'mythic', null, null, '🌟', 'images'),

-- Likes received achievements
('likes_received_1', 'Первый лайк', 'Получил первый лайк', 'basic', null, null, '❤️', 'likes_received'),
('likes_received_10', 'Популярный', 'Получил 10 лайков', 'basic', null, null, '💙', 'likes_received'),
('likes_received_25', 'Любимчик', 'Получил 25 лайков', 'social', null, null, '💜', 'likes_received'),
('likes_received_50', 'Звезда', 'Получил 50 лайков', 'social', null, null, '⭐', 'likes_received'),
('likes_received_75', 'Суперзвезда', 'Получил 75 лайков', 'rare', null, null, '🌟', 'likes_received'),
('likes_received_100', 'Легенда', 'Получил 100 лайков', 'rare', null, null, '👑', 'likes_received'),
('likes_received_250', 'Икона', 'Получил 250 лайков', 'mythic', null, null, '💎', 'likes_received'),
('likes_received_500', 'Божество', 'Получил 500 лайков', 'mythic', null, null, '🌠', 'likes_received'),
('likes_received_1000', 'Бог форума', 'Получил 1000 лайков', 'mythic', null, null, '⚡', 'likes_received'),

-- Likes given achievements
('likes_given_1', 'Щедрый', 'Поставил первый лайк', 'basic', null, null, '👍', 'likes_given'),
('likes_given_10', 'Друг', 'Поставил 10 лайков', 'basic', null, null, '🤝', 'likes_given'),
('likes_given_25', 'Благодетель', 'Поставил 25 лайков', 'social', null, null, '🤗', 'likes_given'),
('likes_given_50', 'Меценат', 'Поставил 50 лайков', 'social', null, null, '🎁', 'likes_given'),
('likes_given_75', 'Филантроп', 'Поставил 75 лайков', 'rare', null, null, '💝', 'likes_given'),
('likes_given_100', 'Ангел', 'Поставил 100 лайков', 'rare', null, null, '😇', 'likes_given'),
('likes_given_250', 'Святой', 'Поставил 250 лайков', 'mythic', null, null, '🙏', 'likes_given'),
('likes_given_500', 'Спаситель', 'Поставил 500 лайков', 'mythic', null, null, '🕊️', 'likes_given'),

-- Thread likes received achievements
('thread_likes_received_1', 'Популярный тред', 'Тред получил первый лайк', 'basic', null, null, '❤️', 'thread_likes_received'),
('thread_likes_received_10', 'Хитовый тред', 'Тред получил 10 лайков', 'basic', null, null, '💙', 'thread_likes_received'),
('thread_likes_received_25', 'Вирусный тред', 'Тред получил 25 лайков', 'social', null, null, '💜', 'thread_likes_received'),
('thread_likes_received_50', 'Легендарный тред', 'Тред получил 50 лайков', 'social', null, null, '⭐', 'thread_likes_received'),
('thread_likes_received_75', 'Эпический тред', 'Тред получил 75 лайков', 'rare', null, null, '🌟', 'thread_likes_received'),
('thread_likes_received_100', 'Мифический тред', 'Тред получил 100 лайков', 'rare', null, null, '👑', 'thread_likes_received'),
('thread_likes_received_250', 'Божественный тред', 'Тред получил 250 лайков', 'mythic', null, null, '💎', 'thread_likes_received'),
('thread_likes_received_500', 'Бессмертный тред', 'Тред получил 500 лайков', 'mythic', null, null, '⚡', 'thread_likes_received'),

-- Thread likes given achievements
('thread_likes_given_1', 'Ценитель', 'Поставил лайк первому треду', 'basic', null, null, '👍', 'thread_likes_given'),
('thread_likes_given_10', 'Эксперт', 'Поставил лайки 10 тредов', 'basic', null, null, '🤝', 'thread_likes_given'),
('thread_likes_given_25', 'Критик', 'Поставил лайки 25 тредов', 'social', null, null, '🤗', 'thread_likes_given'),
('thread_likes_given_50', 'Судья', 'Поставил лайки 50 тредов', 'social', null, null, '🎭', 'thread_likes_given'),
('thread_likes_given_100', 'Мудрец', 'Поставил лайки 100 тредов', 'rare', null, null, '🧠', 'thread_likes_given'),
('thread_likes_given_250', 'Оракул', 'Поставил лайки 250 тредов', 'mythic', null, null, '🔮', 'thread_likes_given'),
('thread_likes_given_500', 'Пророк', 'Поставил лайки 500 тредов', 'mythic', null, null, '👁️', 'thread_likes_given'),

-- Other achievements
('first_thread', 'Первый тред', 'Создал свой первый тред', 'basic', null, null, '🎯', 'threads'),
('first_text_post', 'Пост без картинки', 'Первый текстовый пост', 'basic', null, null, '📝', 'posts'),
('double_post', 'Двойной пост', 'Ответил в одном треде дважды', 'basic', null, null, '✌️', 'activity'),
('first_reply', 'Кто-нибудь ответил', 'Получил первый ответ', 'social', null, null, '💬', 'social'),
('thread_50_posts', 'Мой тред живёт', 'Тред пережил 50 ответов', 'social', 'username_color', 'yellow', '🌟', 'social'),
('thread_500_posts', 'Тред на 500+ постов', 'Создал тред с 500+ постами', 'rare', 'username_color', 'orange', '🔥', 'rare'),
('thread_1000_posts', 'Тред на 1000+ постов', 'Создал тред с 1000+ постами', 'rare', 'username_color', 'gold', '👑', 'rare'),
('war_thread', 'Разожгли войну', 'Тред вызвал холивар на 200+ ответов', 'rare', 'username_color', 'red', '⚔️', 'rare'),
('most_active', 'Доска тебя запомнит', 'Самый активный автор дня', 'rare', 'username_color', 'blue', '⭐', 'rare'),
('photographer', 'Фотограф', 'Загрузил 100 изображений', 'rare', null, null, '📷', 'images'),
('editor_master', 'Мастер редактирования', 'Отредактировал свой пост 10 раз', 'rare', null, null, '✏️', 'activity'),
('repost_king', 'Никогда такого не было', 'Сделал тему, которая уже была 100 раз', 'meme', null, null, '🔄', 'activity'),
('invisible', 'Гений маскировки', 'Постил 24 часа, ни разу не получив ответ', 'meme', null, null, '👻', 'activity'),
('not_bot', 'Я не бот', 'Написал 20 сообщений подряд за 1 минуту', 'meme', null, null, '🤖', 'activity'),
('random_hero', 'Случайный герой', 'Случайно оживил забытый тред', 'meme', null, null, '🦸', 'activity'),
('necromancer', 'Некромант', 'Воскресил тред, которому 2+ дней', 'behavior', null, null, '💀', 'activity'),
('artist', 'Артист', 'Постил только картинки весь день', 'behavior', null, null, '🎨', 'activity'),
('writer', 'Писатель', 'Написал 10 постов без картинок', 'behavior', null, null, '✍️', 'activity'),
('capslocker', 'Капслокер', 'Тред из сообщений ВСЕ ЗАГЛАВНЫМИ', 'behavior', null, null, '🔊', 'activity'),
('long_post', 'Слишком длинный пост', 'Написал пост длиннее 5000 символов', 'secret', null, null, '📜', 'secret'),
('big_image', 'Формат для богов', 'Загрузил PNG больше 10MB', 'secret', null, null, '🖼️', 'secret'),
('webp_user', 'Загрузил WEBP', 'Редкая штука', 'secret', null, null, '🎯', 'secret'),
('respect', 'Уважение анонов', 'Получил 20 лайков/апвотов', 'social', 'username_color', 'cyan', '💙', 'social'),
('immortal_thread', 'Тред, который не умер', 'Тред живёт дольше недели', 'mythic', 'username_color', 'green', '🌲', 'mythic'),
('resurrection', 'Воскрешение', 'Тред ожил после 24+ часов мёртвого состояния', 'mythic', null, null, '⚡', 'mythic'),
('immortal', 'Бессмертный', 'Тред с 2000+ ответами', 'mythic', 'username_color', 'purple', '💜', 'mythic'),

-- New achievements for settings and activity
('font_customizer', 'Персонализатор', 'Изменил шрифт в настройках', 'basic', null, null, '🎨', 'settings'),
('rules_reader', 'Юрист', 'Прочитал соглашение сайта', 'basic', null, null, '📖', 'activity'),
('custom_message_thread', 'Специальный гость', 'Зашёл в тред с пользовательским сообщением', 'social', null, null, '🎪', 'activity')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  reward_type = EXCLUDED.reward_type,
  reward_value = EXCLUDED.reward_value,
  icon = EXCLUDED.icon,
  achievement_type = EXCLUDED.achievement_type;

-- Create proper image achievement function
CREATE OR REPLACE FUNCTION public.check_image_upload_achievements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  image_count INTEGER;
BEGIN
  IF (NEW.image_url IS NOT NULL OR NEW.image_urls IS NOT NULL) THEN
    -- Get user's current image count
    SELECT COALESCE(image_upload_count, 0) INTO image_count
    FROM profiles WHERE id = NEW.user_id;

    -- Award achievements based on image count (only if not already awarded)
    IF image_count >= 1 THEN
      PERFORM award_achievement_with_level(NEW.user_id, 'images', 1);
    END IF;
    IF image_count >= 10 THEN
      PERFORM award_achievement_with_level(NEW.user_id, 'images', 2);
    END IF;
    IF image_count >= 25 THEN
      PERFORM award_achievement_with_level(NEW.user_id, 'images', 3);
    END IF;
    IF image_count >= 50 THEN
      PERFORM award_achievement_with_level(NEW.user_id, 'images', 4);
    END IF;
    IF image_count >= 100 THEN
      PERFORM award_achievement_with_level(NEW.user_id, 'images', 5);
    END IF;
    IF image_count >= 250 THEN
      PERFORM award_achievement_with_level(NEW.user_id, 'images', 6);
    END IF;
    IF image_count >= 500 THEN
      PERFORM award_achievement_with_level(NEW.user_id, 'images', 7);
    END IF;
    IF image_count >= 1000 THEN
      PERFORM award_achievement_with_level(NEW.user_id, 'images', 8);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate the image trigger
DROP TRIGGER IF EXISTS check_image_upload_achievements_trigger ON posts;
CREATE TRIGGER check_image_upload_achievements_trigger
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION check_image_upload_achievements();

-- Also update threads if they have images
DROP TRIGGER IF EXISTS check_thread_image_achievements_trigger ON threads;
CREATE TRIGGER check_thread_image_achievements_trigger
  AFTER INSERT ON threads
  FOR EACH ROW
  EXECUTE FUNCTION check_image_upload_achievements();