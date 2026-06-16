-- ============================================================
-- 066: Per-guest, per-event activity log.
--
-- A click-away history for each guest at an event: when they RSVP'd, when
-- they were moved to the waitlist, promoted, paid, checked in, etc. Pings
-- (reminders / promotions / nudges) already live in notifications_log, so
-- the UI merges this table with that; this captures the *state transitions*
-- that aren't otherwise recorded (rsvps only keeps the latest state).
--
-- Populated by an AFTER trigger on rsvps. SECURITY DEFINER so it can write
-- regardless of who triggered the change (public RPCs run as definer too).
-- Admin-readable only.
-- ============================================================

CREATE TABLE IF NOT EXISTS rsvp_activity (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rsvp_id    UUID NOT NULL REFERENCES rsvps(id) ON DELETE CASCADE,
  event_id   UUID NOT NULL,
  guest_id   UUID NOT NULL,
  kind       TEXT NOT NULL,   -- created | status | payment | walk_in | checked_in
  detail     TEXT,            -- e.g. 'waitlisted → pending_payment'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rsvp_activity_event_guest_idx
  ON rsvp_activity (event_id, guest_id, created_at);
CREATE INDEX IF NOT EXISTS rsvp_activity_rsvp_idx
  ON rsvp_activity (rsvp_id);

ALTER TABLE rsvp_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rsvp_activity_admin_read ON rsvp_activity;
CREATE POLICY rsvp_activity_admin_read ON rsvp_activity
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION log_rsvp_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO rsvp_activity (rsvp_id, event_id, guest_id, kind, detail)
    VALUES (NEW.id, NEW.event_id, NEW.guest_id, 'created', NEW.status);
    IF NEW.walk_in THEN
      INSERT INTO rsvp_activity (rsvp_id, event_id, guest_id, kind, detail)
      VALUES (NEW.id, NEW.event_id, NEW.guest_id, 'walk_in', NULL);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: record only the fields that actually changed.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO rsvp_activity (rsvp_id, event_id, guest_id, kind, detail)
    VALUES (NEW.id, NEW.event_id, NEW.guest_id, 'status',
            COALESCE(OLD.status, '∅') || ' → ' || COALESCE(NEW.status, '∅'));
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    INSERT INTO rsvp_activity (rsvp_id, event_id, guest_id, kind, detail)
    VALUES (NEW.id, NEW.event_id, NEW.guest_id, 'payment',
            COALESCE(OLD.payment_status, '∅') || ' → ' || COALESCE(NEW.payment_status, '∅'));
  END IF;

  IF NEW.checked_in_at IS NOT NULL AND OLD.checked_in_at IS NULL THEN
    INSERT INTO rsvp_activity (rsvp_id, event_id, guest_id, kind, detail)
    VALUES (NEW.id, NEW.event_id, NEW.guest_id, 'checked_in', NULL);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rsvps_activity_log ON rsvps;
CREATE TRIGGER rsvps_activity_log
  AFTER INSERT OR UPDATE ON rsvps
  FOR EACH ROW
  EXECUTE FUNCTION log_rsvp_activity();

-- Backfill a 'created' row for existing RSVPs so their history isn't blank.
INSERT INTO rsvp_activity (rsvp_id, event_id, guest_id, kind, detail, created_at)
SELECT id, event_id, guest_id, 'created', status, created_at
FROM   rsvps
WHERE  NOT EXISTS (
  SELECT 1 FROM rsvp_activity a WHERE a.rsvp_id = rsvps.id
);
