-- Create profile_customization table
CREATE TABLE IF NOT EXISTS public.profile_customization (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  username_css TEXT,
  username_icon_svg TEXT,
  username_icon_fill TEXT,
  username_icon_stroke TEXT,
  profile_badge_text TEXT,
  profile_badge_css TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.profile_customization ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view all profile customizations"
  ON public.profile_customization
  FOR SELECT
  USING (true);

CREATE POLICY "Users can insert their own profile customization"
  ON public.profile_customization
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile customization"
  ON public.profile_customization
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own profile customization"
  ON public.profile_customization
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_profile_customization_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER update_profile_customization_updated_at
  BEFORE UPDATE ON public.profile_customization
  FOR EACH ROW
  EXECUTE FUNCTION update_profile_customization_updated_at();
