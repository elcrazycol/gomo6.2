-- Add online status fields to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;

-- Add online status privacy settings
ALTER TABLE public.privacy_settings ADD COLUMN IF NOT EXISTS show_last_seen BOOLEAN DEFAULT true;
ALTER TABLE public.privacy_settings ADD COLUMN IF NOT EXISTS show_online_status BOOLEAN DEFAULT true;

-- Create function to update last_seen_at
CREATE OR REPLACE FUNCTION update_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles
  SET last_seen_at = NOW()
  WHERE id = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to update last_seen on auth activity
-- Note: This is a simplified version. In production, you might want to use a heartbeat system

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_last_seen_at ON public.profiles(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_profiles_is_online ON public.profiles(is_online);
