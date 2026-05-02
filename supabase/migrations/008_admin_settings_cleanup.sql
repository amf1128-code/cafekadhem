-- Recreate admin_settings UPDATE policy with an explicit WITH CHECK (true)
-- to ensure both the visibility and validity tests are unambiguous, and add
-- an INSERT policy so the first-time save path works when no row exists.
-- Also drops the unused cafe_name column.

DROP POLICY IF EXISTS "Admin can update settings" ON admin_settings;
CREATE POLICY "Admin can update settings"
  ON admin_settings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin can insert settings" ON admin_settings;
CREATE POLICY "Admin can insert settings"
  ON admin_settings FOR INSERT
  TO authenticated
  WITH CHECK (true);

ALTER TABLE admin_settings DROP COLUMN IF EXISTS cafe_name;
