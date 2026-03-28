-- Create user_placeholders table
CREATE TABLE IF NOT EXISTS public.user_placeholders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  placeholder_1 TEXT,
  placeholder_2 TEXT,
  placeholder_3 TEXT,
  custom_placeholder TEXT,
  use_custom BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE public.user_placeholders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all placeholders" ON public.user_placeholders FOR SELECT USING (true);
CREATE POLICY "Users can insert their own placeholders" ON public.user_placeholders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own placeholders" ON public.user_placeholders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own placeholders" ON public.user_placeholders FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_user_placeholders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_placeholders_updated_at
  BEFORE UPDATE ON public.user_placeholders
  FOR EACH ROW
  EXECUTE FUNCTION update_user_placeholders_updated_at();
