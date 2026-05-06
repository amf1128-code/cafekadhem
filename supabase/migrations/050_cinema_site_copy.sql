-- ============================================================
-- 050: Cinema landing site-wide copy.
--
-- Adds a single editable site-wide blurb that renders above the
-- "Current Menu" grid on the cinema landing. Defaults to the
-- existing hardcoded text so the page reads the same out of the
-- gate; admin can edit it from /admin/settings.
-- ============================================================

ALTER TABLE admin_settings
  ADD COLUMN IF NOT EXISTS current_menu_blurb TEXT;

COMMENT ON COLUMN admin_settings.current_menu_blurb IS
  'Italic blurb shown under the "CURRENT MENU." heading on the cinema landing.';

UPDATE admin_settings
   SET current_menu_blurb = 'The menu rotates with the night. This one travels with the pop-up — small, snackable, easy to eat one-handed.'
 WHERE current_menu_blurb IS NULL;
