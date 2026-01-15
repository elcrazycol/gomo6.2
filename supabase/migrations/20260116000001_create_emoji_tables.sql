-- Create emoji_groups table
CREATE TABLE IF NOT EXISTS emoji_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create emojis table
CREATE TABLE IF NOT EXISTS emojis (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES emoji_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  image_url TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_emojis_updated_at
  BEFORE UPDATE ON emojis
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE emoji_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE emojis ENABLE ROW LEVEL SECURITY;

-- RLS Policies for emoji_groups
CREATE POLICY "Allow moderators to manage emoji groups" ON emoji_groups
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role IN ('moderator', 'admin')
    )
  );

-- RLS Policies for emojis
CREATE POLICY "Allow moderators to manage emojis" ON emojis
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role IN ('moderator', 'admin')
    )
  );

-- Allow all users to read emojis
CREATE POLICY "Allow everyone to read emojis" ON emojis
  FOR SELECT USING (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_emojis_group_id ON emojis(group_id);
CREATE INDEX IF NOT EXISTS idx_emojis_code ON emojis(code);
CREATE INDEX IF NOT EXISTS idx_emoji_groups_name ON emoji_groups(name);

-- Insert default group
INSERT INTO emoji_groups (name) VALUES ('По умолчанию')
ON CONFLICT (name) DO NOTHING;