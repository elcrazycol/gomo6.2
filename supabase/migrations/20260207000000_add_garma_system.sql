-- Add garma (karma-like) system

-- 1) Column on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS garma INTEGER NOT NULL DEFAULT 0;

-- 2) Calculation function
CREATE OR REPLACE FUNCTION public.calculate_garma(user_uuid UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH metrics AS (
    SELECT
      COALESCE((
        SELECT COUNT(*)
        FROM public.post_likes pl
        JOIN public.posts p ON pl.post_id = p.id
        WHERE p.user_id = user_uuid
      ), 0) AS post_likes_received,
      COALESCE((
        SELECT COUNT(*)
        FROM public.thread_likes tl
        JOIN public.threads t ON tl.thread_id = t.id
        WHERE t.user_id = user_uuid
      ), 0) AS thread_likes_received,
      COALESCE((
        SELECT COUNT(*) FROM public.posts p WHERE p.user_id = user_uuid
      ), 0) AS posts_written,
      COALESCE((
        SELECT COUNT(*) FROM public.threads t WHERE t.user_id = user_uuid
      ), 0) AS threads_written,
      COALESCE((
        SELECT COUNT(*)
        FROM public.posts p
        JOIN public.threads t ON p.thread_id = t.id
        WHERE t.user_id = user_uuid AND p.user_id <> user_uuid
      ), 0) AS replies_in_user_threads,
      COALESCE((
        SELECT total_minutes FROM public.user_session_time st WHERE st.user_id = user_uuid
      ), 0) AS minutes_spent
  )
  SELECT (
    -- Likes received on own posts
    post_likes_received * 2 +
    -- Likes on user threads are more valuable
    thread_likes_received * 3 +
    -- Own activity: posts + threads
    CEIL(posts_written * 0.5)::INTEGER +
    threads_written * 4 +
    -- Community activity in their threads
    CEIL(replies_in_user_threads * 0.25)::INTEGER +
    -- Time spent: 1 garma per 30 minutes
    FLOOR(minutes_spent / 30)
  )::INTEGER
  FROM metrics;
$$;

-- 3) Helper to persist value on profiles
CREATE OR REPLACE FUNCTION public.refresh_user_garma(user_uuid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET garma = public.calculate_garma(user_uuid)
  WHERE id = user_uuid;
END;
$$;

-- 4) Helpers per table
CREATE OR REPLACE FUNCTION public.refresh_garma_for_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  thread_owner UUID;
  target_thread_id UUID;
  target_user_id UUID;
BEGIN
  target_thread_id := COALESCE(NEW.thread_id, OLD.thread_id);
  target_user_id := COALESCE(NEW.user_id, OLD.user_id);

  IF target_user_id IS NOT NULL THEN
    PERFORM public.refresh_user_garma(target_user_id);
  END IF;

  IF target_thread_id IS NOT NULL THEN
    SELECT user_id INTO thread_owner FROM public.threads WHERE id = target_thread_id;
    IF thread_owner IS NOT NULL AND thread_owner <> target_user_id THEN
      PERFORM public.refresh_user_garma(thread_owner);
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_garma_for_post_like()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_owner UUID;
  target_post_id UUID;
BEGIN
  target_post_id := COALESCE(NEW.post_id, OLD.post_id);
  IF target_post_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT user_id INTO post_owner FROM public.posts WHERE id = target_post_id;
  IF post_owner IS NOT NULL THEN
    PERFORM public.refresh_user_garma(post_owner);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_garma_for_thread_like()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  thread_owner UUID;
  target_thread_id UUID;
BEGIN
  target_thread_id := COALESCE(NEW.thread_id, OLD.thread_id);
  IF target_thread_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT user_id INTO thread_owner FROM public.threads WHERE id = target_thread_id;
  IF thread_owner IS NOT NULL THEN
    PERFORM public.refresh_user_garma(thread_owner);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_garma_for_thread()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id UUID;
BEGIN
  owner_id := COALESCE(NEW.user_id, OLD.user_id);
  IF owner_id IS NOT NULL THEN
    PERFORM public.refresh_user_garma(owner_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_garma_for_session_time()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_user_garma(COALESCE(NEW.user_id, OLD.user_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 5) Triggers
DROP TRIGGER IF EXISTS trg_refresh_garma_on_post_insert ON public.posts;
CREATE TRIGGER trg_refresh_garma_on_post_insert
AFTER INSERT ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.refresh_garma_for_post();

DROP TRIGGER IF EXISTS trg_refresh_garma_on_post_delete ON public.posts;
CREATE TRIGGER trg_refresh_garma_on_post_delete
AFTER DELETE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.refresh_garma_for_post();

DROP TRIGGER IF EXISTS trg_refresh_garma_on_post_update ON public.posts;
CREATE TRIGGER trg_refresh_garma_on_post_update
AFTER UPDATE OF user_id, thread_id ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.refresh_garma_for_post();

DROP TRIGGER IF EXISTS trg_refresh_garma_on_post_like_insert ON public.post_likes;
CREATE TRIGGER trg_refresh_garma_on_post_like_insert
AFTER INSERT ON public.post_likes
FOR EACH ROW EXECUTE FUNCTION public.refresh_garma_for_post_like();

DROP TRIGGER IF EXISTS trg_refresh_garma_on_post_like_delete ON public.post_likes;
CREATE TRIGGER trg_refresh_garma_on_post_like_delete
AFTER DELETE ON public.post_likes
FOR EACH ROW EXECUTE FUNCTION public.refresh_garma_for_post_like();

DROP TRIGGER IF EXISTS trg_refresh_garma_on_thread_like_insert ON public.thread_likes;
CREATE TRIGGER trg_refresh_garma_on_thread_like_insert
AFTER INSERT ON public.thread_likes
FOR EACH ROW EXECUTE FUNCTION public.refresh_garma_for_thread_like();

DROP TRIGGER IF EXISTS trg_refresh_garma_on_thread_like_delete ON public.thread_likes;
CREATE TRIGGER trg_refresh_garma_on_thread_like_delete
AFTER DELETE ON public.thread_likes
FOR EACH ROW EXECUTE FUNCTION public.refresh_garma_for_thread_like();

DROP TRIGGER IF EXISTS trg_refresh_garma_on_thread_insert ON public.threads;
CREATE TRIGGER trg_refresh_garma_on_thread_insert
AFTER INSERT ON public.threads
FOR EACH ROW EXECUTE FUNCTION public.refresh_garma_for_thread();

DROP TRIGGER IF EXISTS trg_refresh_garma_on_thread_delete ON public.threads;
CREATE TRIGGER trg_refresh_garma_on_thread_delete
AFTER DELETE ON public.threads
FOR EACH ROW EXECUTE FUNCTION public.refresh_garma_for_thread();

DROP TRIGGER IF EXISTS trg_refresh_garma_on_session_time ON public.user_session_time;
CREATE TRIGGER trg_refresh_garma_on_session_time
AFTER INSERT OR UPDATE OF total_minutes ON public.user_session_time
FOR EACH ROW EXECUTE FUNCTION public.refresh_garma_for_session_time();

-- 6) Backfill
UPDATE public.profiles SET garma = public.calculate_garma(id);
