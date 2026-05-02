-- ============================================================
-- Public site URL + tickets storage bucket
-- ============================================================
--   1. admin_settings.site_url is the single source of truth for
--      the canonical public origin used in outbound emails (and
--      eventually anywhere else we mint a public link server-side).
--   2. The tickets bucket holds one PNG per issued ticket so the QR
--      can be embedded in the email itself, not just linked.
-- ============================================================

ALTER TABLE admin_settings
  ADD COLUMN IF NOT EXISTS site_url TEXT NOT NULL DEFAULT 'https://cafekadhem.com';

-- Storage bucket for ticket QR images
INSERT INTO storage.buckets (id, name, public)
VALUES ('tickets', 'tickets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admin can manage tickets bucket"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'tickets')
  WITH CHECK (bucket_id = 'tickets');

CREATE POLICY "Public can read ticket QR images"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'tickets');
