-- Create the 'flyers' storage bucket for event flyer images
-- This must exist before uploading files via supabase.storage.from('flyers')
INSERT INTO storage.buckets (id, name, public)
VALUES ('flyers', 'flyers', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users (admin) to upload files
CREATE POLICY "Admin can upload flyers"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'flyers');

-- Allow authenticated users to update/delete their uploads
CREATE POLICY "Admin can update flyers"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'flyers');

CREATE POLICY "Admin can delete flyers"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'flyers');

-- Allow public read access to flyer images
CREATE POLICY "Public can read flyers"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'flyers');
