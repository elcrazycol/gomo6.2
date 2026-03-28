-- Create emojis storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('emojis', 'emojis', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to emojis bucket
CREATE POLICY "Allow moderators to upload emojis" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'emojis'
    AND auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role IN ('moderator', 'admin')
    )
  );

-- Allow everyone to read emojis
CREATE POLICY "Allow everyone to read emojis" ON storage.objects
  FOR SELECT USING (bucket_id = 'emojis');

-- Allow moderators to delete emojis
CREATE POLICY "Allow moderators to delete emojis" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'emojis'
    AND EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role IN ('moderator', 'admin')
    )
  );