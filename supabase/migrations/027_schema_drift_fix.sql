-- ============================================================
-- Schema drift recovery.
--
-- The production database is missing columns that earlier migrations
-- (002_waitlist.sql, 022_sms_toggle.sql) were supposed to add but
-- evidently never landed here. Without them:
--   * safe_create_rsvp fails with: column "waitlist_position" does not exist
--   * RSVPForm's admin_settings.sms_enabled query errors
--
-- This migration is idempotent (uses IF NOT EXISTS) so it's safe to run
-- on any DB that already has some of these columns.
-- ============================================================

-- From 002_waitlist.sql
ALTER TABLE rsvps
  ADD COLUMN IF NOT EXISTS waitlist_position INTEGER,
  ADD COLUMN IF NOT EXISTS waitlisted_at     TIMESTAMPTZ;

-- Allow 'waitlisted' as a valid status. Drop the old auto-named check
-- (yes/maybe/no only) and replace it with one that includes 'waitlisted'.
ALTER TABLE rsvps DROP CONSTRAINT IF EXISTS rsvps_status_check;
DO $$
BEGIN
  EXECUTE (
    SELECT 'ALTER TABLE rsvps DROP CONSTRAINT ' || conname
    FROM pg_constraint
    WHERE conrelid = 'rsvps'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
    LIMIT 1
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
ALTER TABLE rsvps ADD CONSTRAINT rsvps_status_check
  CHECK (status IN ('yes', 'maybe', 'no', 'waitlisted'));

CREATE INDEX IF NOT EXISTS idx_rsvps_waitlist
  ON rsvps (event_id, waitlist_position)
  WHERE status = 'waitlisted';

-- From 022_sms_toggle.sql
ALTER TABLE admin_settings
  ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT false;
