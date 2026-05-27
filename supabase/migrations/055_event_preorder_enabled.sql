ALTER TABLE events
  ADD COLUMN IF NOT EXISTS preorder_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN events.preorder_enabled IS
  'When false, the attached menu is shown read-only — guests can browse items but the pre-order cart, add buttons, and checkout are hidden.';
