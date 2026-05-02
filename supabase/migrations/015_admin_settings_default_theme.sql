-- Allow `default` as a valid value for admin_settings.theme. When set,
-- the home page renders in the next upcoming event's theme; otherwise
-- the chosen theme overrides the home page regardless of upcoming events.
-- Event detail pages are unaffected — they always follow their own theme.
ALTER TABLE admin_settings DROP CONSTRAINT IF EXISTS admin_settings_theme_check;

ALTER TABLE admin_settings
  ADD CONSTRAINT admin_settings_theme_check
    CHECK (theme IN ('default', 'theme1', 'theme2', 'theme3'));

-- Switch the column default so freshly seeded sites start in 'default'
-- (next-event driven), which is the most natural setting for this app.
ALTER TABLE admin_settings ALTER COLUMN theme SET DEFAULT 'default';
