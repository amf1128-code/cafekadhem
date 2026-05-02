-- Allow `theme3` ("Watch Party" — gradient/glow/floating shapes) as a valid
-- value for the admin-controlled site theme. The 007 migration created the
-- check constraint with only theme1/theme2; we drop and recreate it so
-- existing rows stay valid and new theme3 selections are accepted.
ALTER TABLE admin_settings DROP CONSTRAINT IF EXISTS admin_settings_theme_check;

ALTER TABLE admin_settings
  ADD CONSTRAINT admin_settings_theme_check
    CHECK (theme IN ('theme1', 'theme2', 'theme3'));
