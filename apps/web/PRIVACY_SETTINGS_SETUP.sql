-- Execute this SQL in your Supabase SQL Editor to create the privacy settings table

-- Create privacy settings table
CREATE TABLE IF NOT EXISTS privacy_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  visibility_profile BOOLEAN DEFAULT true,
  hide_messages_from_unregistered BOOLEAN DEFAULT false,
  hide_threads_from_unregistered BOOLEAN DEFAULT false,
  block_profile_visits_from_unregistered BOOLEAN DEFAULT false,
  allow_search_by_username BOOLEAN DEFAULT true,
  allow_search_by_id BOOLEAN DEFAULT true,
  allow_search_by_secondary_id BOOLEAN DEFAULT true,
  allow_private_messages BOOLEAN DEFAULT true,
  anonymous_mode BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Each user can have only one privacy settings record
  UNIQUE(user_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_privacy_settings_user_id ON privacy_settings(user_id);

-- Enable RLS
ALTER TABLE privacy_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "Users can view their own privacy settings" ON privacy_settings;
CREATE POLICY "Users can view their own privacy settings" ON privacy_settings
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view others privacy settings" ON privacy_settings;
CREATE POLICY "Users can view others privacy settings" ON privacy_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert their own privacy settings" ON privacy_settings;
CREATE POLICY "Users can insert their own privacy settings" ON privacy_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own privacy settings" ON privacy_settings;
CREATE POLICY "Users can update their own privacy settings" ON privacy_settings
  FOR UPDATE USING (auth.uid() = user_id);

-- Function to automatically create privacy settings for new users
CREATE OR REPLACE FUNCTION create_default_privacy_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO privacy_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create privacy settings when a new profile is created
DROP TRIGGER IF EXISTS on_profile_created ON profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION create_default_privacy_settings();

-- Create privacy settings for existing users
INSERT INTO privacy_settings (user_id)
SELECT id FROM profiles
WHERE id NOT IN (SELECT user_id FROM privacy_settings)
ON CONFLICT (user_id) DO NOTHING;