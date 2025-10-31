
-- Create trigger to update profile stats when thread is created
CREATE TRIGGER update_profile_on_thread_created
  AFTER INSERT ON public.threads
  FOR EACH ROW
  EXECUTE FUNCTION update_profile_stats();

-- Create trigger to update profile stats when post is created
CREATE TRIGGER update_profile_on_post_created
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION update_profile_stats();

-- Create trigger to check first thread achievement
CREATE TRIGGER check_first_thread_trigger
  AFTER INSERT ON public.threads
  FOR EACH ROW
  EXECUTE FUNCTION check_first_thread_achievement();

-- Create trigger to check first post achievement
CREATE TRIGGER check_first_post_trigger
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION check_first_post_achievement();

-- Create trigger to check image post achievement
CREATE TRIGGER check_image_post_trigger
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION check_image_achievement();
