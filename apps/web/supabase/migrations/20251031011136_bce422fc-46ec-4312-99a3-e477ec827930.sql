-- Create storage bucket for images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'post-images',
  'post-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
);

-- Storage policies for post images
CREATE POLICY "Anyone can view post images"
ON storage.objects FOR SELECT
USING (bucket_id = 'post-images');

CREATE POLICY "Authenticated users can upload post images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'post-images' 
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Users can update their own post images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'post-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own post images"
ON storage.objects FOR DELETE
USING (bucket_id = 'post-images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Update profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS thread_count INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS post_count INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS edit_count INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS image_upload_count INTEGER DEFAULT 0;

-- RLS for profiles updates
CREATE POLICY "Users can update their own profile" ON public.profiles
FOR UPDATE USING (auth.uid() = id);

-- Add reply_to field to posts
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES public.posts(id) ON DELETE SET NULL;

-- Create app_role enum for user roles
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create user_roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- RLS for user_roles
CREATE POLICY "Everyone can view user roles" ON public.user_roles
FOR SELECT USING (true);

-- Security definer function to check user role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Create achievements table
CREATE TABLE IF NOT EXISTS public.achievements (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  reward_type TEXT,
  reward_value TEXT,
  icon TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view achievements" ON public.achievements
FOR SELECT USING (true);

-- Create user_achievements table
CREATE TABLE IF NOT EXISTS public.user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  achievement_id TEXT REFERENCES public.achievements(id) ON DELETE CASCADE NOT NULL,
  unlocked_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, achievement_id)
);

ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view user achievements" ON public.user_achievements
FOR SELECT USING (true);

CREATE POLICY "Users earn their achievements automatically" ON public.user_achievements
FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create reports table
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reported_post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  reported_thread_id UUID REFERENCES public.threads(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  moderator_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  moderator_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  resolved_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can create reports" ON public.reports
FOR INSERT WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Moderators can view all reports" ON public.reports
FOR SELECT USING (
  public.has_role(auth.uid(), 'admin') OR 
  public.has_role(auth.uid(), 'moderator')
);

CREATE POLICY "Moderators can update reports" ON public.reports
FOR UPDATE USING (
  public.has_role(auth.uid(), 'admin') OR 
  public.has_role(auth.uid(), 'moderator')
);

-- Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  related_thread_id UUID REFERENCES public.threads(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications" ON public.notifications
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications" ON public.notifications
FOR UPDATE USING (auth.uid() = user_id);

-- Add is_rules_board to boards
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS is_rules_board BOOLEAN DEFAULT false;

-- Update boards with new boards
UPDATE public.boards SET name = 'Random / Всё подряд' WHERE slug = 'b';
UPDATE public.boards SET name = 'Технологии / IT' WHERE slug = 'g';

INSERT INTO public.boards (slug, name, description) VALUES
  ('pol', 'Политика', 'Политические дискуссии'),
  ('a', 'Аниме', 'Обсуждение аниме и манги'),
  ('v', 'Видеоигры', 'Игры и геймдев'),
  ('mu', 'Музыка', 'Музыка и музыканты'),
  ('fit', 'Фитнес', 'Спорт и здоровье'),
  ('d', 'Для взрослых', 'NSFW контент'),
  ('tv', 'Кино и сериалы', 'Обсуждение фильмов и сериалов'),
  ('co', 'Комиксы', 'Комиксы и графические романы'),
  ('int', 'International', 'Международная доска')
ON CONFLICT (slug) DO NOTHING;

-- Create rules board
INSERT INTO public.boards (slug, name, description, is_rules_board) VALUES
  ('rules', 'Правила', 'Правила и информация о 6gomo', true)
ON CONFLICT (slug) DO NOTHING;

-- RLS for rules board threads
CREATE POLICY "Only moderators can create threads on rules board" ON public.threads
FOR INSERT WITH CHECK (
  CASE 
    WHEN (SELECT is_rules_board FROM public.boards WHERE id = board_id) = true
    THEN public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator')
    ELSE auth.uid() = user_id
  END
);

-- RLS for rules board posts
CREATE POLICY "Only admins can post on rules board" ON public.posts
FOR INSERT WITH CHECK (
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.threads t
      JOIN public.boards b ON t.board_id = b.id
      WHERE t.id = thread_id AND b.is_rules_board = true
    )
    THEN public.has_role(auth.uid(), 'admin')
    ELSE auth.uid() = user_id
  END
);

-- Function to create notification on reply
CREATE OR REPLACE FUNCTION public.notify_on_reply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  replied_user_id UUID;
  thread_title TEXT;
BEGIN
  -- Get the user_id of the post being replied to
  IF NEW.reply_to IS NOT NULL THEN
    SELECT user_id INTO replied_user_id
    FROM public.posts
    WHERE id = NEW.reply_to;
    
    -- Get thread title
    SELECT title INTO thread_title
    FROM public.threads
    WHERE id = NEW.thread_id;
    
    -- Create notification if not replying to self
    IF replied_user_id IS NOT NULL AND replied_user_id != NEW.user_id THEN
      INSERT INTO public.notifications (user_id, type, title, message, related_post_id, related_thread_id)
      VALUES (
        replied_user_id,
        'reply',
        'Новый ответ на ваше сообщение',
        'Кто-то ответил на ваше сообщение в треде "' || thread_title || '"',
        NEW.id,
        NEW.thread_id
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger for notifications
DROP TRIGGER IF EXISTS on_post_reply ON public.posts;
CREATE TRIGGER on_post_reply
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_reply();

-- Function to update profile stats
CREATE OR REPLACE FUNCTION public.update_profile_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'threads' THEN
    UPDATE public.profiles
    SET thread_count = thread_count + 1
    WHERE id = NEW.user_id;
  ELSIF TG_TABLE_NAME = 'posts' THEN
    UPDATE public.profiles
    SET post_count = post_count + 1
    WHERE id = NEW.user_id;
    
    -- Update image count if image is uploaded
    IF NEW.image_url IS NOT NULL THEN
      UPDATE public.profiles
      SET image_upload_count = image_upload_count + 1
      WHERE id = NEW.user_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Triggers for profile stats
DROP TRIGGER IF EXISTS on_thread_created ON public.threads;
CREATE TRIGGER on_thread_created
  AFTER INSERT ON public.threads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_profile_stats();

DROP TRIGGER IF EXISTS on_post_created ON public.posts;
CREATE TRIGGER on_post_created
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_profile_stats();

-- Insert all achievements
INSERT INTO public.achievements (id, name, description, category, reward_type, reward_value, icon) VALUES
  -- Базовые
  ('first_thread', 'Первый тред', 'Создал свой первый тред', 'basic', null, null, '🎯'),
  ('first_text_post', 'Пост без картинки', 'Первый текстовый пост', 'basic', null, null, '📝'),
  ('first_image_post', 'Пост с пикчей', 'Загрузил первое изображение', 'basic', null, null, '🖼️'),
  ('double_post', 'Двойной пост', 'Ответил в одном треде дважды', 'basic', null, null, '✌️'),
  ('posts_10', 'Первые 10 сообщений', 'Написал 10 сообщений', 'basic', null, null, '🔟'),
  ('posts_100', 'Первые 100 сообщений', 'Написал 100 сообщений', 'basic', null, null, '💯'),
  
  -- Социальные
  ('first_reply', 'Кто-нибудь ответил', 'Получил первый ответ', 'social', null, null, '💬'),
  ('thread_50_posts', 'Мой тред живёт', 'Тред пережил 50 ответов', 'social', 'username_color', 'yellow', '🌟'),
  
  -- Редкие
  ('thread_500_posts', 'Тред на 500+ постов', 'Создал тред с 500+ постами', 'rare', 'username_color', 'orange', '🔥'),
  ('thread_1000_posts', 'Тред на 1000+ постов', 'Создал тред с 1000+ постами', 'rare', 'username_color', 'gold', '👑'),
  ('war_thread', 'Разожгли войну', 'Тред вызвал холивар на 200+ ответов', 'rare', 'username_color', 'red', '⚔️'),
  ('most_active', 'Доска тебя запомнит', 'Самый активный автор дня', 'rare', 'username_color', 'blue', '⭐'),
  ('photographer', 'Фотограф', 'Загрузил 100 изображений', 'rare', null, null, '📷'),
  ('editor_master', 'Мастер редактирования', 'Отредактировал свой пост 10 раз', 'rare', null, null, '✏️'),
  
  -- Мемные
  ('repost_king', 'Никогда такого не было', 'Сделал тему, которая уже была 100 раз', 'meme', null, null, '🔄'),
  ('invisible', 'Гений маскировки', 'Постил 24 часа, ни разу не получив ответ', 'meme', null, null, '👻'),
  ('not_bot', 'Я не бот', 'Написал 20 сообщений подряд за 1 минуту', 'meme', null, null, '🤖'),
  ('random_hero', 'Случайный герой', 'Случайно оживил забытый тред', 'meme', null, null, '🦸'),
  
  -- Поведение
  ('necromancer', 'Некромант', 'Воскресил тред, которому 2+ дней', 'behavior', null, null, '💀'),
  ('artist', 'Артист', 'Постил только картинки весь день', 'behavior', null, null, '🎨'),
  ('writer', 'Писатель', 'Написал 10 постов без картинок', 'behavior', null, null, '✍️'),
  ('capslocker', 'Капслокер', 'Тред из сообщений ВСЕ ЗАГЛАВНЫМИ', 'behavior', null, null, '🔊'),
  
  -- Секретные
  ('long_post', 'Слишком длинный пост', 'Написал пост длиннее 5000 символов', 'secret', null, null, '📜'),
  ('big_image', 'Формат для богов', 'Загрузил PNG больше 10MB', 'secret', null, null, '🖼️'),
  ('webp_user', 'Загрузил WEBP', 'Редкая штука', 'secret', null, null, '🎯'),
  
  -- Социальные 2.0
  ('respect', 'Уважение анонов', 'Получил 20 лайков/апвотов', 'social', 'username_color', 'cyan', '💙'),
  
  -- Мифические
  ('immortal_thread', 'Тред, который не умер', 'Тред живёт дольше недели', 'mythic', 'username_color', 'green', '🌲'),
  ('resurrection', 'Воскрешение', 'Тред ожил после 24+ часов мёртвого состояния', 'mythic', null, null, '⚡'),
  ('immortal', 'Бессмертный', 'Тред с 2000+ ответами', 'mythic', 'username_color', 'purple', '💜')
ON CONFLICT (id) DO NOTHING;