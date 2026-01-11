-- Add RLS policies for users to delete and update their own posts
CREATE POLICY "Users can delete their own posts"
ON public.posts
FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own posts"
ON public.posts
FOR UPDATE
USING (auth.uid() = user_id);

-- Add achievements for post management
INSERT INTO public.achievements (id, name, description, icon, category)
VALUES
  ('first_post_edit', 'Редактор', 'Отредактировал свой первый пост', '✏️', 'basic'),
  ('first_post_delete', 'Чистильщик', 'Удалил свой первый пост', '🗑️', 'basic')
ON CONFLICT (id) DO NOTHING;

-- Function to award post management achievements
CREATE OR REPLACE FUNCTION public.award_post_management_achievement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Award achievement for editing post
  IF TG_OP = 'UPDATE' THEN
    PERFORM award_achievement(NEW.user_id, 'first_post_edit');
  END IF;

  -- Award achievement for deleting post
  IF TG_OP = 'DELETE' THEN
    PERFORM award_achievement(OLD.user_id, 'first_post_delete');
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Triggers for post management achievements
CREATE TRIGGER award_post_edit_trigger
  AFTER UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.award_post_management_achievement();

CREATE TRIGGER award_post_delete_trigger
  AFTER DELETE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.award_post_management_achievement();